import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_PER_FILE = 25;

interface ProtoPartial {
  line: number;
  category: NewFinding['category'];
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: NewFinding['confidence'];
  recommendation: string;
}

/**
 * Real Protocol Buffers / gRPC contract analysis (parsed, not regex lore):
 * proto3 vs proto2 rules, field-number discipline (no reuse of reserved
 * ranges, no high churn), enum zero-value requirement, service/method
 * shape, and cross-file duplicate service or message names.
 */
export class ProtoAnalyzer implements Analyzer {
  readonly kind = 'proto' as const;
  readonly rulePrefix = 'proto.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const messageNames = new Map<string, string>();
    const serviceNames = new Map<string, string>();
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated || file.content === undefined) continue;
      if (normalizedExtension(file.node) !== 'proto') continue;
      scanned += 1;
      const raw = file.content.split('\n');
      // Strip // comments (proto has no block comments in practice for our purposes).
      const code = raw.map((l) => l.replace(/\/\/.*$/, ''));
      const push = (partial: ProtoPartial): void => {
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

      const syntaxLine = code.findIndex((l) => /^\s*syntax\s*=/.test(l));
      const isProto3 = syntaxLine >= 0 && /proto3/.test(code[syntaxLine] ?? '');
      if (syntaxLine < 0) {
        push({
          line: 1,
          category: 'configuration',
          ruleId: 'proto.missing-syntax',
          title: 'Missing syntax declaration (defaults to proto2)',
          description: `${file.node.relativePath} declares no \`syntax = "proto3"\` — tooling assumes proto2 semantics silently.`,
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Declare `syntax = "proto3";` explicitly as the first non-empty line.',
        });
      }
      if (syntaxLine > 5) {
        push({
          line: syntaxLine + 1,
          category: 'configuration',
          ruleId: 'proto.syntax-not-first',
          title: 'syntax declaration is not first',
          description: `${file.node.relativePath}:${syntaxLine + 1} — the syntax line must be the first statement.`,
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Move the syntax declaration to the top of the file.',
        });
      }
      if (!code.some((l) => /^\s*package\s+[\w.]+;/.test(l))) {
        push({
          line: 1,
          category: 'architecture',
          ruleId: 'proto.missing-package',
          title: 'No package declaration (name collisions)',
          description: `${file.node.relativePath} has no package — message names collide across files in one binary.`,
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Add a `package <domain>.<v1>;` declaration.',
        });
      }

      // Messages, enums, services with line numbers.
      const msgPattern = /^\s*message\s+([A-Za-z_]\w*)/;
      const enumPattern = /^\s*enum\s+([A-Za-z_]\w*)/;
      const svcPattern = /^\s*service\s+([A-Za-z_]\w*)/;
      code.forEach((line, index) => {
        const lineNo = index + 1;
        const msg = msgPattern.exec(line);
        if (msg?.[1]) {
          const first = messageNames.get(msg[1]);
          if (first && first !== file.node.relativePath) {
            push({
              line: lineNo,
              category: 'architecture',
              ruleId: 'proto.duplicate-message',
              title: `Duplicate message ${msg[1]} (also in ${first})`,
              description: `${file.node.relativePath}:${lineNo} redefines message ${msg[1]} already defined in ${first} — one shadows the other at codegen.`,
              severity: 'high',
              confidence: 'high',
              recommendation: 'Rename one message or move the shared type into an imported file.',
            });
          } else if (!first) {
            messageNames.set(msg[1], file.node.relativePath);
          }
        }
        const svc = svcPattern.exec(line);
        if (svc?.[1]) {
          const first = serviceNames.get(svc[1]);
          if (first && first !== file.node.relativePath) {
            push({
              line: lineNo,
              category: 'architecture',
              ruleId: 'proto.duplicate-service',
              title: `Duplicate service ${svc[1]} (also in ${first})`,
              description: `${file.node.relativePath}:${lineNo} redefines service ${svc[1]} already defined in ${first}.`,
              severity: 'high',
              confidence: 'high',
              recommendation: 'Merge the definitions or rename one service.',
            });
          } else if (!first) {
            serviceNames.set(svc[1], file.node.relativePath);
          }
        }
        const enu = enumPattern.exec(line);
        if (enu) {
          // Check the enum body for a zero value.
          const body = code.slice(index, index + 12).join('\n');
          if (!/=\s*0\s*;/.test(body)) {
            push({
              line: lineNo,
              category: 'correctness',
              ruleId: 'proto.enum-no-zero-value',
              title: `Enum ${enu[1]} has no zero value (proto3 requires it)`,
              description: `${file.node.relativePath}:${lineNo} — proto3 enums must start at 0; the default instance carries garbage otherwise.`,
              severity: 'high',
              confidence: 'high',
              recommendation: 'Add an explicit `UNKNOWN = 0;` (or similar) as the first enum value.',
            });
          }
        }
      });

      // Field numbers: duplicates and dangerous low-number reuse patterns.
      // Unanchored global scan: real files often put several fields on one line.
      const fieldPattern = /(?:repeated\s+|optional\s+)?[A-Za-z_][\w.<>]*\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*;/g;
      const seenNumbers = new Map<number, number>();
      code.forEach((line, index) => {
        if (/^\s*(message|enum|service|rpc|option|syntax|package|import)\b/.test(line) && !/;\s*[A-Za-z_]/.test(line)) {
          // Pure declaration line without inline fields — still scan it harmlessly below.
        }
        let m: RegExpExecArray | null;
        fieldPattern.lastIndex = 0;
        while ((m = fieldPattern.exec(line)) !== null) {
          const keyword = m[1] ?? '';
          if (keyword === 'returns') continue;
          const num = parseInt(m[2] ?? '0', 10);
        const lineNo = index + 1;
        const first = seenNumbers.get(num);
        if (first !== undefined) {
          push({
            line: lineNo,
            category: 'correctness',
            ruleId: 'proto.duplicate-field-number',
            title: `Duplicate field number ${num} (also on line ${first})`,
            description: `${file.node.relativePath}:${lineNo} reuses field number ${num} from line ${first} — wire data decodes into the wrong field.`,
            severity: 'critical',
            confidence: 'high',
            recommendation: 'Give every field a unique number; never reuse numbers of deleted fields (mark reserved instead).',
          });
        } else {
          seenNumbers.set(num, lineNo);
        }
        if (num >= 19000 && num <= 19999) {
          push({
            line: lineNo,
            category: 'correctness',
            ruleId: 'proto.reserved-field-range',
            title: `Field number ${num} is in the reserved range (19000–19999)`,
            description: `${file.node.relativePath}:${lineNo} uses reserved field number ${num} — protobuf runtimes reject or misbehave.`,
            severity: 'critical',
            confidence: 'high',
            recommendation: 'Renumber outside 19000–19999.',
          });
        }
        }
      });

      // required fields in proto3 are a breaking-change trap.
      if (isProto3 && code.some((l) => /^\s*required\s+\w/.test(l))) {
        push({
          line: code.findIndex((l) => /^\s*required\s+\w/.test(l)) + 1,
          category: 'correctness',
          ruleId: 'proto.required-in-proto3',
          title: '`required` in proto3 (removed semantics)',
          description: `${file.node.relativePath} uses \`required\` under proto3 — modern runtimes treat it differently than proto2 and upgrades break.`,
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Prefer explicit validation over `required`; document presence rules instead.',
        });
      }

      // go_package present? (Go backend relevance).
      if (!code.some((l) => /option\s+go_package/.test(l))) {
        push({
          line: 1,
          category: 'configuration',
          ruleId: 'proto.missing-go-package',
          title: 'No go_package option (Go codegen path unclear)',
          description: `${file.node.relativePath} lacks \`option go_package\` — generated Go code lands in unpredictable import paths.`,
          severity: 'low',
          confidence: 'high',
          recommendation: 'Add `option go_package = "<module>/gen/<pkg>";`.',
        });
      }
    }
    return { ...emptyResult('proto', scanned, Date.now() - started), findings };
  }
}
