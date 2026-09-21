import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_PER_FILE = 25;

interface ScriptPartial {
  line: number;
  category: NewFinding['category'];
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: NewFinding['confidence'];
  recommendation: string;
}

type ScriptFamily = 'powershell' | 'batch' | 'shell';

/**
 * Real Windows/Unix script analysis (no execution): PowerShell (.ps1),
 * Batch (.bat/.cmd), and Shell (.sh/.bash/.zsh) get family-specific checks —
 * execution-policy bypass, plaintext credentials, unquoted paths, rm -rf,
 * curl-pipe-shell, `set -e` absence, and undefined-variable risks.
 */
export class ScriptsAnalyzer implements Analyzer {
  readonly kind = 'scripts' as const;
  readonly rulePrefix = 'scripts.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated || file.content === undefined) continue;
      const ext = normalizedExtension(file.node);
      const family: ScriptFamily | undefined =
        ext === 'ps1' || ext === 'psm1' || ext === 'psd1'
          ? 'powershell'
          : ext === 'bat' || ext === 'cmd'
            ? 'batch'
            : ext === 'sh' || ext === 'bash' || ext === 'zsh'
              ? 'shell'
              : undefined;
      if (!family) continue;
      scanned += 1;
      const lines = file.content.split('\n');
      const push = (partial: ScriptPartial): void => {
        if (findings.filter((f) => f.path === file.node.relativePath).length >= MAX_PER_FILE) return;
        findings.push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            source: 'analyzer',
            evidence: [],
            relatedFiles: [],
            relatedSymbols: [],
            ...partial,
          }),
        );
      };

      if (family === 'powershell') this.powershellChecks(file.node.relativePath, lines, push);
      if (family === 'batch') this.batchChecks(file.node.relativePath, lines, push);
      if (family === 'shell') this.shellChecks(file.node.relativePath, lines, push);
    }
    return { ...emptyResult('scripts', scanned, Date.now() - started), findings };
  }

  private powershellChecks(rel: string, lines: string[], push: (p: ScriptPartial) => void): void {
    const body = lines.join('\n');
    const hasStop = /\$ErrorActionPreference\s*=\s*['"]?Stop['"]?|Set-StrictMode\s+-Version/i.test(body);
    if (!hasStop && lines.length > 5) {
      push({
        line: 1,
        category: 'correctness',
        ruleId: 'scripts.ps-no-strict-mode',
        title: 'No fail-fast mode (errors continue silently)',
        description: `${rel} never sets $ErrorActionPreference='Stop' or Set-StrictMode — a failed command continues the script as if nothing happened.`,
        severity: 'medium',
        confidence: 'medium',
        recommendation: "Add `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest` at the top.",
      });
    }
    lines.forEach((raw, index) => {
      const lineNo = index + 1;
      const line = raw.replace(/#.*$/, '');
      if (/Bypass/i.test(line) && /ExecutionPolicy/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.ps-execution-policy-bypass',
          title: 'ExecutionPolicy Bypass (security control disabled)',
          description: `${rel}:${lineNo} disables the script execution policy — signed-code enforcement is gone for this run.`,
          severity: 'high',
          confidence: 'high',
          recommendation: 'Sign scripts properly instead of bypassing the policy; scope Bypass narrowly if unavoidable.',
        });
      }
      if (/\$Password\s*=\s*['"][^'"]+['"]|ConvertTo-SecureString\s+['"][^'"]+['"]\s+-AsPlainText/i.test(raw)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.ps-plaintext-credential',
          title: 'Plaintext credential in script',
          description: `${rel}:${lineNo} embeds a password/secret in cleartext — anyone with read access owns it.`,
          severity: 'critical',
          confidence: 'high',
          recommendation: 'Pull secrets from a vault/secret store or prompt with Read-Host -AsSecureString.',
        });
      }
      if (/\bInvoke-Expression\b|\bIEX\b/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.ps-invoke-expression',
          title: 'Invoke-Expression on dynamic content (injection)',
          description: `${rel}:${lineNo} executes a string as code via Invoke-Expression — downloaded or interpolated input becomes arbitrary execution.`,
          severity: 'high',
          confidence: 'medium',
          recommendation: 'Avoid IEX; use script blocks, parameters, or & with explicit arguments.',
        });
      }
      if (/\bRemove-Item\b.*-Recurse.*-Force/i.test(line) && !/\$|WhatIf|Confirm/i.test(line)) {
        push({
          line: lineNo,
          category: 'correctness',
          ruleId: 'scripts.ps-recursive-delete-unguarded',
          title: 'Recursive delete with no guard/WhatIf',
          description: `${rel}:${lineNo} deletes recursively with -Force and no path guard or -WhatIf — one wrong variable wipes data.`,
          severity: 'high',
          confidence: 'medium',
          recommendation: 'Validate the path is non-empty/expected first, and support -WhatIf.',
        });
      }
      if (/\$null\s*=\s*[^ ]|2>\s*\$null|\$ErrorActionPreference\s*=\s*['"]?SilentlyContinue/i.test(line)) {
        push({
          line: lineNo,
          category: 'correctness',
          ruleId: 'scripts.ps-swallowed-error',
          title: 'Errors explicitly swallowed',
          description: `${rel}:${lineNo} discards errors ($null redirect or SilentlyContinue) — failures become invisible.`,
          severity: 'medium',
          confidence: 'medium',
          recommendation: 'Handle errors explicitly with try/catch instead of silencing them.',
        });
      }
      if (/\bStart-Process\b/i.test(line) && /-Verb\s+RunAs/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.ps-elevation',
          title: 'Silent privilege elevation (RunAs)',
          description: `${rel}:${lineNo} re-launches itself elevated — UAC prompts can be social-engineered and the elevated half runs unchecked.`,
          severity: 'medium',
          confidence: 'medium',
          recommendation: 'Document why elevation is required and drop privileges as soon as possible.',
        });
      }
    });
  }

  private batchChecks(rel: string, lines: string[], push: (p: ScriptPartial) => void): void {
    lines.forEach((raw, index) => {
      const lineNo = index + 1;
      const line = raw.trim();
      if (/^del\s+(\/s|\/q)/i.test(line) || /\brd\s+\/s\s+\/q\b/i.test(line)) {
        push({
          line: lineNo,
          category: 'correctness',
          ruleId: 'scripts.bat-recursive-delete',
          title: 'Recursive/forced delete in batch script',
          description: `${rel}:${lineNo} deletes recursively (${line.slice(0, 60)}) — unquoted variables here destroy the wrong tree.`,
          severity: 'high',
          confidence: 'medium',
          recommendation: 'Quote every path, verify the variable is set (if not defined ... exit), and echo first.',
        });
      }
      if (/%[A-Za-z_]\w*%/.test(line) && !/^"/.test(line) && /\b(del|rd|copy|xcopy|move|rmdir)\b/i.test(line)) {
        push({
          line: lineNo,
          category: 'correctness',
          ruleId: 'scripts.bat-unquoted-variable',
          title: 'Unquoted %VAR% in a destructive command',
          description: `${rel}:${lineNo} expands %VAR% unquoted in a file command — spaces split it into multiple targets.`,
          severity: 'medium',
          confidence: 'medium',
          recommendation: 'Quote expansions: "%VAR%" and guard with `if not defined VAR exit /b 1`.',
        });
      }
      if (/\bset\s+\w*(password|secret|token|key)\w*\s*=/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.bat-plaintext-credential',
          title: 'Plaintext credential in batch script',
          description: `${rel}:${lineNo} stores a secret in a plain environment variable — visible to every child process.`,
          severity: 'critical',
          confidence: 'high',
          recommendation: 'Read secrets from a vault at runtime instead of hardcoding them.',
        });
      }
      if (/powershell.*-EncodedCommand|powershell.*Bypass/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.bat-encoded-powershell',
          title: 'Batch shells out to obfuscated PowerShell',
          description: `${rel}:${lineNo} invokes PowerShell with -EncodedCommand or Bypass — the classic living-off-the-land hiding spot.`,
          severity: 'high',
          confidence: 'high',
          recommendation: 'Inline the logic readably or call a signed .ps1 with constrained language mode.',
        });
      }
    });
  }

  private shellChecks(rel: string, lines: string[], push: (p: ScriptPartial) => void): void {
    const head = lines.slice(0, 5).join('\n');
    if (!/set\s+-[a-z]*e/.test(head) && lines.length > 5) {
      push({
        line: 1,
        category: 'correctness',
        ruleId: 'scripts.sh-no-set-e',
        title: 'No `set -euo pipefail` (failures ignored)',
        description: `${rel} runs without \`set -euo pipefail\` — failed commands and unset variables pass silently.`,
        severity: 'medium',
        confidence: 'medium',
        recommendation: 'Add `set -euo pipefail` near the top of the script.',
      });
    }
    lines.forEach((raw, index) => {
      const lineNo = index + 1;
      const line = raw.replace(/#.*$/, '');
      if (/\bcurl\b[^|]*\|\s*(sudo\s+)?(bash|sh)\b/.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.sh-curl-pipe-shell',
          title: 'curl piped to shell (supply-chain risk)',
          description: `${rel}:${lineNo} executes a downloaded script unverified.`,
          severity: 'critical',
          confidence: 'high',
          recommendation: 'Download, verify the checksum/signature, review, then execute.',
        });
      }
      if (/\brm\s+(-[a-z]*r[a-z]*\s+|\s+)/.test(line) && /\$\w+/.test(line) && !/["']\$\w+["']/.test(line)) {
        push({
          line: lineNo,
          category: 'correctness',
          ruleId: 'scripts.sh-rm-unquoted-var',
          title: 'rm with unquoted variable (wrong tree risk)',
          description: `${rel}:${lineNo} passes an unquoted variable to rm — word splitting can target unintended paths.`,
          severity: 'high',
          confidence: 'medium',
          recommendation: 'Quote ("$var"), and guard with `${var:?}` so empty never means root.',
        });
      }
      if (/\bsudo\b/.test(line) && !/NOPASSWD|sudo\s+-n/.test(line) && /apt|yum|dnf|pacman|brew|choco/i.test(line)) {
        push({
          line: lineNo,
          category: 'security',
          ruleId: 'scripts.sh-sudo-install',
          title: 'Unattended sudo package install',
          description: `${rel}:${lineNo} installs packages via sudo non-interactively — a compromised mirror owns the machine.`,
          severity: 'medium',
          confidence: 'medium',
          recommendation: 'Pin versions, verify signatures, and log what was installed.',
        });
      }
    });
  }
}
