// Builds the provider sprite + the two coverage layers, printed to stdout.
// Paths come from @lobehub/icons-static-svg, not from memory.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./node_modules/@lobehub/icons-static-svg/icons/', import.meta.url));

const PROVIDERS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Google Gemini'],
  ['meta', 'Meta Llama'],
  ['mistral', 'Mistral AI'],
  ['cohere', 'Cohere'],
  ['deepseek', 'DeepSeek'],
  ['grok', 'xAI Grok'],
  ['qwen', 'Alibaba Qwen'],
  ['microsoft', 'Microsoft Phi'],
  ['bedrock', 'Amazon Bedrock'],
  ['gemma', 'Google Gemma'],
  ['ai21', 'AI21 Labs'],
  ['dbrx', 'Databricks'],
  ['perplexity', 'Perplexity'],
  ['nvidia', 'NVIDIA'],
  ['ibm', 'IBM Granite'],
  ['stability', 'Stability AI'],
  ['moonshot', 'Moonshot Kimi'],
  ['zhipu', 'Zhipu GLM'],
  ['minimax', 'MiniMax'],
  ['yi', '01.AI Yi'],
  ['baichuan', 'Baichuan'],
  ['huggingface', 'Hugging Face'],
  ['voyage', 'Voyage AI'],
  ['groq', 'Groq'],
  ['together', 'Together AI'],
  ['fireworks', 'Fireworks AI'],
  ['cerebras', 'Cerebras'],
  ['ollama', 'Ollama'],
];

// Symbols only, no mark: these are the rest of the routing table, and they exist
// so the console's intake stream has a hundred-odd distinct marks to rise
// through rather than the same thirty on a loop. Chosen for breadth across what
// alphe routes — model labs, hosts, agent frameworks, tools — and, within that,
// for path weight: the sprite is inline on every page load, so a 20 kB icon
// buys nothing a 400 B one does not.
const EXTRA = [
  'xai', 'claude', 'ai2', 'alephalpha', 'baai', 'baidu', 'bytedance', 'doubao',
  'hunyuan', 'liquid', 'sensenova', 'stepfun', 'tii', 'upstage', 'zeroone',
  'kimi', 'longcat', 'spark', 'wenxin', 'yuanbao', 'zai', 'inflection',
  'deepcogito', 'arcee', 'openchat', 'nova', 'palm', 'aya', 'inception',
  'skywork', 'hailuo', 'flux', 'bfl', 'elevenlabs', 'suno', 'luma', 'pika',
  'runway', 'kling', 'vidu', 'recraft', 'assemblyai', 'deepl', 'replicate',
  'novita', 'hyperbolic', 'sambanova', 'lambda', 'baseten', 'anyscale',
  'siliconcloud', 'openrouter', 'nebius', 'crusoe', 'lmstudio', 'vllm',
  'volcengine', 'alibabacloud', 'huaweicloud', 'modelscope', 'poe', 'workersai',
  'google', 'azure', 'googlecloud', 'cloudflare', 'snowflake', 'github',
  'notion', 'n8n', 'zapier', 'make', 'langchain', 'llamaindex', 'crewai', 'mcp',
  'cursor', 'windsurf', 'replit', 'vercel', 'v0', 'lovable', 'comfyui', 'dify',
  'coze', 'exa', 'tavily', 'firecrawl', 'jina', 'deepmind', 'alibaba',
];

const symbols = [];
const marks = [];

const symbol = (slug) => {
  const raw = fs.readFileSync(DIR + slug + '.svg', 'utf8');
  const vb = raw.match(/viewBox="([^"]+)"/)[1];
  const rule = /fill-rule="([^"]+)"/.exec(raw);
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '');
  return `          <symbol id="p-${slug}" viewBox="${vb}"${rule ? ` fill-rule="${rule[1]}"` : ''}>${body}</symbol>`;
};

for (const [slug, label] of PROVIDERS) {
  symbols.push(symbol(slug));
  marks.push(
    `            <span class="mark" role="img" aria-label="${label}" title="${label}"\n              ><svg class="mark__glyph" aria-hidden="true"><use href="#p-${slug}" /></svg\n            ></span>`
  );
}

for (const slug of EXTRA) symbols.push(symbol(slug));

const more = `            <span class="mark mark--more">+ 4,500 models</span>`;

console.log('=== SYMBOLS ===');
console.log(symbols.join('\n'));
console.log('=== MARKS ===');
console.log(marks.join('\n'));
console.log(more);
console.log('=== bytes ===', symbols.join('').length);
