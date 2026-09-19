import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../public/markdown-renderer.js', import.meta.url), 'utf8'), context);
const markdown = vm.runInContext('CodexWebMarkdown', context) as {
  createRenderer(options?: { canRenderSessionFileLink: (path: string) => boolean }): {
    renderMarkdown(value: string, options?: { documentMode: boolean }): string;
  };
};
const { renderMarkdown } = markdown.createRenderer();

test('ordered lists retain numbering, nested lists and continuation text', () => {
  const html = renderMarkdown([
    '3. Open the session',
    '   and keep the draft.',
    '4. Resize the window',
    '   - Keep the current message',
    '     + Confirm its attachment',
    '   - Check the composer',
    '5. Return to the session',
    '',
    'A separate paragraph.',
  ].join('\n'));
  assert.equal(html, '<ol start="3"><li>Open the session and keep the draft.</li><li>Resize the window<ul><li>Keep the current message<ul><li>Confirm its attachment</li></ul></li><li>Check the composer</li></ul></li><li>Return to the session</li></ol><p>A separate paragraph.</p>');
});

test('loose list items retain paragraphs and stop before independent blocks', () => {
  const html = renderMarkdown('- First\n\n  Second paragraph\n\n- Next\n\n## Heading\n\n1) Ordered\n2) Another\n\n---\n\nEnd');
  assert.equal(html, '<ul><li><p>First</p><p>Second paragraph</p></li><li><p>Next</p></li></ul><h2>Heading</h2><ol><li>Ordered</li><li>Another</li></ol><hr><p>End</p>');
  assert.equal(renderMarkdown('- First\n1. Second\n# Heading'), '<ul><li>First</li></ul><ol><li>Second</li></ol><h1>Heading</h1>');
});

test('list code remains literal and does not consume the next step', () => {
  const html = renderMarkdown('1. Run\n   ```sh\n   echo "<ready>"\n   - literal\n   ```\n2. Inspect');
  assert.equal(html, '<ol><li>Run<pre><code>echo &quot;&lt;ready&gt;&quot;\n- literal\n</code></pre></li><li>Inspect</li></ol>');
});

test('all six heading levels and horizontal rules remain separate from prose', () => {
  const html = renderMarkdown('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n\n***\n\nA **bold** sentence.');
  assert.equal(html, '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6><hr><p>A <strong>bold</strong> sentence.</p>');
});

test('fences require matching character and length and preserve unclosed content', () => {
  assert.equal(renderMarkdown('````md\n```js\nconst x = 1;\n```\n~~~~\n````\nAfter'), '<pre><code>```js\nconst x = 1;\n```\n~~~~\n</code></pre><p>After</p>');
  assert.equal(renderMarkdown('~~~text\n  indented\n~~~not-a-closer'), '<pre><code>  indented\n~~~not-a-closer\n</code></pre>');
});

test('document scroll regions have names and escaped labels without changing chat markup', () => {
  const content = '| Field | Value |\n| --- | --- |\n| A \\| B | `x|y` |\n\n```bash\n  npm run typecheck\n```';
  const document = renderMarkdown(content, { documentMode: true });
  const chat = renderMarkdown(content);
  assert.match(document, /class="markdown-table" tabindex="0" role="region" aria-label="Field \/ Value"/u);
  assert.match(document, /<figcaption>bash<\/figcaption><pre tabindex="0" role="region" aria-label="bash"><code>  npm run typecheck\n<\/code>/u);
  assert.match(document, /A \| B<\/td><td[^>]*><code>x\|y<\/code>/u);
  assert.doesNotMatch(chat, /tabindex|figcaption|figure/u);
  const unsafe = renderMarkdown('| <img> | "quoted" |\n| --- | --- |\n| <script>bad()</script> | safe |\n\n```"><img>\n<script>bad()</script>\n```', { documentMode: true });
  assert.match(unsafe, /aria-label="&lt;img&gt; \/ &quot;quoted&quot;"/u);
  assert.match(unsafe, /<figcaption>&quot;&gt;&lt;img&gt;<\/figcaption>/u);
  assert.doesNotMatch(unsafe, /<script|<img/u);
});

test('nested document content follows the same session file link policy', () => {
  const restricted = markdown.createRenderer({ canRenderSessionFileLink: () => false });
  const content = '1. [Local](docs/plan.md)\n   - [Web](https://example.org/docs)\n   - [Unsafe](javascript:alert(1))';
  const html = restricted.renderMarkdown(content, { documentMode: true });
  assert.match(html, /href="https:\/\/example.org\/docs" target="_blank" rel="noopener noreferrer"/u);
  assert.doesNotMatch(html, /data-session-file-path|href="javascript:/u);
  assert.match(renderMarkdown(content), /data-session-file-path="docs\/plan.md"/u);
});

test('deeply nested input stays bounded without discarding the final content', () => {
  const content = Array.from({ length: 100 }, (_, index) => `${'  '.repeat(index)}- depth ${index}`).join('\n');
  const html = renderMarkdown(content, { documentMode: true });
  assert.match(html, /depth 99/u);
  assert.equal((html.match(/<ul>/gu) || []).length, 32);
});
