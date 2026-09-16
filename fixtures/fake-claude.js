// Fake `claude` binary: validates the flags and prints a canned CLI result.
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => args[args.indexOf(f) + 1];
if (!has('-p') || !has('--json-schema') || !has('--output-format') || !has('--system-prompt')) {
  console.error('bad args');
  process.exit(2);
}
const prompt = args[args.length - 1];
if (prompt.includes('FAIL')) {
  console.log(JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }));
  process.exit(0);
}
const schema = JSON.parse(val('--json-schema'));
if ('$schema' in schema) {
  console.error('Error: --json-schema is not a valid JSON Schema: no schema with key or ref');
  process.exit(1);
}
const isFood = 'items' in schema.properties;
const out = isFood
  ? { items: [{ name: 'eggs', kcal: 140, proteinG: 12 }], kcal: 140, proteinG: 12, note: `model=${val('--model')}` }
  : { summary: `ok for ${val('--model')}`, wins: [], flags: [], nextWeek: ['keep going'], nutrition: 'fine', proposals: [] };
console.log(JSON.stringify({ is_error: false, result: JSON.stringify(out), structured_output: out }));
