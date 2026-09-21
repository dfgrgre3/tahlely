import { describe, expect, it } from 'vitest';
import { GoAnalyzer, ProtoAnalyzer, ScriptsAnalyzer } from '@tahlely/analysis';
import type { AnalyzerContext } from '@tahlely/analysis';
import type { FileNode, ProjectId } from '@tahlely/domain';
import { newId } from '@tahlely/domain';

function node(relativePath: string, extension: string, language: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'prj_1' as ProjectId,
    path: `/repo/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: language as FileNode['language'],
    size: 100,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: false,
    importance: 1,
    risk: 0,
  };
}

function ctx(files: { relativePath: string; extension: string; language: string; content: string }[]): AnalyzerContext {
  return {
    analysisId: 'anl_1' as AnalyzerContext['analysisId'],
    projectId: 'prj_1' as AnalyzerContext['projectId'],
    projectRoot: '/repo',
    files: files.map((f) => ({ node: node(f.relativePath, f.extension, f.language), content: f.content })),
  };
}

describe('go analyzer', () => {
  it('flags unchecked errors, panic, SQL concat, and log.Fatal', async () => {
    const result = await new GoAnalyzer().analyze(ctx([
      {
        relativePath: 'internal/db/store.go',
        extension: '.go',
        language: 'go',
        content: [
          'package store',
          '',
          'import ("database/sql"; "fmt"; "log")',
          '',
          'func Get(id string) (string, error) {',
          '\trows, err := db.Query("SELECT * FROM users WHERE id = " + id)',
          '\tif rows == nil {',
          '\t\treturn "", nil',
          '\t}',
          '\tlog.Fatal("unreachable here")',
          '\treturn "", nil',
          '}',
          '',
          'func Crash() { panic("boom") }',
          '',
          'func Debug() { fmt.Println("debug") }',
        ].join('\n'),
      },
    ]));
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('go.unchecked-error');
    expect(rules).toContain('go.sql-concatenation');
    expect(rules).toContain('go.log-fatal-in-library');
    expect(rules).toContain('go.panic-in-library');
    expect(result.filesScanned).toBe(1);
  });
});

describe('scripts analyzer', () => {
  it('flags PowerShell bypass + plaintext credential and batch deletes', async () => {
    const ps = await new ScriptsAnalyzer().analyze(ctx([
      {
        relativePath: 'scripts/deploy.ps1',
        extension: '.ps1',
        language: 'powershell',
        content: [
          'Set-ExecutionPolicy Bypass -Scope Process',
          '$Password = "SuperSecret123"',
          'Invoke-Expression $remote',
          'Remove-Item C:\\data -Recurse -Force',
        ].join('\n'),
      },
    ]));
    const psRules = ps.findings.map((f) => f.ruleId);
    expect(psRules).toContain('scripts.ps-execution-policy-bypass');
    expect(psRules).toContain('scripts.ps-plaintext-credential');
    expect(psRules).toContain('scripts.ps-invoke-expression');

    const bat = await new ScriptsAnalyzer().analyze(ctx([
      {
        relativePath: 'scripts/clean.bat',
        extension: '.bat',
        language: 'batch',
        content: 'rd /s /q %TARGET%\nset API_KEY=abc123',
      },
    ]));
    const batRules = bat.findings.map((f) => f.ruleId);
    expect(batRules).toContain('scripts.bat-recursive-delete');
    expect(batRules).toContain('scripts.bat-plaintext-credential');
  });
});

describe('proto analyzer', () => {
  it('flags duplicate fields, reserved range, enum without zero, duplicates', async () => {
    const result = await new ProtoAnalyzer().analyze(ctx([
      {
        relativePath: 'api/v1/user.proto',
        extension: '.proto',
        language: 'proto',
        content: [
          'syntax = "proto3";',
          'package api.v1;',
          'enum Role { ADMIN = 1; USER = 2; }',
          'message User { string id = 1; string name = 1; string ext = 19001; }',
          'service UserService { rpc Get (Req) returns (Res); }',
        ].join('\n'),
      },
      {
        relativePath: 'api/v2/user.proto',
        extension: '.proto',
        language: 'proto',
        content: [
          'syntax = "proto3";',
          'package api.v2;',
          'message User { string id = 1; }',
          'service UserService { rpc Get (Req) returns (Res); }',
        ].join('\n'),
      },
    ]));
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('proto.enum-no-zero-value');
    expect(rules).toContain('proto.duplicate-field-number');
    expect(rules).toContain('proto.reserved-field-range');
    expect(rules).toContain('proto.duplicate-message');
    expect(rules).toContain('proto.duplicate-service');
  });
});
