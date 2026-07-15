import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const headingLine = `## ${heading}`;
  const lines = markdown.split('\n');
  const headingStart = lines.indexOf(headingLine);
  assert.notEqual(headingStart, -1, `missing Markdown section: ${headingLine}`);

  const sectionLines = lines.slice(headingStart + 1);
  const nextHeadingStart = sectionLines.findIndex((line) => line.startsWith('## '));
  const sectionEnd = nextHeadingStart === -1 ? sectionLines.length : nextHeadingStart;
  return sectionLines.slice(0, sectionEnd).join('\n');
}

test('install.md is the AI install entrypoint for GitHub blob links and local project installs', async () => {
  const installDoc = await readRepoFile('install.md');

  assert.match(installDoc, /ai_entrypoint:\s*true/u);
  assert.match(installDoc, /README\.md/u);
  assert.match(installDoc, /install\.md/u);
  assert.match(installDoc, /Windows.*unsupported/iu);
  assert.match(installDoc, /scripts\/install\/install-codex-web-macos\.sh/u);
  assert.match(installDoc, /--password-stdin/u);
  assert.doesNotMatch(installDoc, /--password\s+['"<]/u);
  assert.match(installDoc, /Do not ask the user to send their password/u);
  assert.match(installDoc, /--autostart/u);
  assert.match(installDoc, /skills\/codex-mobile-report/u);
  assert.match(installDoc, /skills\/codex-web-user-context/u);
  assert.match(installDoc, /~\/\.codex\/skills\/codex-web-user-context/u);
  assert.match(installDoc, /~\/\.codex-web\/reports\//u);
  assert.match(installDoc, /phone-readable report/u);
  assert.match(installDoc, /fully trusted users/u);
  assert.match(installDoc, /CODEX_WEB_PUBLIC_SHARES_ENABLED=true/u);
  assert.match(installDoc, /hourly private log rotation/u);
});

test('README files point AI installers to install.md and include PWA setup guidance', async () => {
  const readme = await readRepoFile('README.md');
  const readmeZh = await readRepoFile('README.zh-CN.md');
  const updateSection = extractMarkdownSection(
    readme,
    'Updating An Existing macOS LaunchAgent Install',
  );
  const updateSectionZh = extractMarkdownSection(
    readmeZh,
    '更新已有的 macOS LaunchAgent 安装',
  );

  assert.match(readme, /install\.md/u);
  assert.match(readme, /AI install/i);
  assert.match(readme, /Help me install https:\/\/github\.com\/chenyanshan\/codex-mobile-web-app\/blob\/main\/README\.md/u);
  assert.match(readme, /codex-mobile-report/u);
  assert.match(readme, /codex-web-user-context/u);
  assert.match(readme, /~\/\.codex\/skills\//u);
  assert.match(readme, /Add to Home Screen/u);
  assert.match(readme, /Android/u);
  assert.match(readme, /not tenant, OS-user, process, Codex-runtime, or filesystem isolation/u);
  assert.match(readme, /CODEX_WEB_PUBLIC_SHARES_ENABLED=true/u);
  assert.match(readme, /Storage lifecycle/u);
  assert.match(readme, /CODEX_WEB_LOG_GENERATIONS/u);
  assert.match(
    updateSection,
    /```bash\ngit pull --ff-only\nnpm install\nscripts\/service\/restart-codex-web-launchd-user\.sh\n```/u,
  );
  assert.match(updateSection, /reopen or refresh the installed PWA/iu);
  assert.match(updateSection, /CODEX_REAL_BIN[\s\S]*?ultra/iu);

  assert.match(readmeZh, /install\.md/u);
  assert.match(readmeZh, /AI 安装/u);
  assert.match(readmeZh, /帮我安装 https:\/\/github\.com\/chenyanshan\/codex-mobile-web-app\/blob\/main\/README\.md/u);
  assert.match(readmeZh, /codex-mobile-report/u);
  assert.match(readmeZh, /codex-web-user-context/u);
  assert.match(readmeZh, /~\/\.codex\/skills\//u);
  assert.match(readmeZh, /添加到主屏幕/u);
  assert.match(readmeZh, /Android/u);
  assert.match(readmeZh, /不提供 tenant、OS 用户、进程、Codex runtime 或/u);
  assert.match(readmeZh, /CODEX_WEB_PUBLIC_SHARES_ENABLED=true/u);
  assert.match(readmeZh, /存储生命周期/u);
  assert.match(readmeZh, /CODEX_WEB_LOG_GENERATIONS/u);
  assert.match(
    updateSectionZh,
    /```bash\ngit pull --ff-only\nnpm install\nscripts\/service\/restart-codex-web-launchd-user\.sh\n```/u,
  );
  assert.match(updateSectionZh, /重新打开或刷新已安装的 PWA/u);
  assert.match(updateSectionZh, /CODEX_REAL_BIN[\s\S]*?ultra/iu);
});
