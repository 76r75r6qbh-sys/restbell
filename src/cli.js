#!/usr/bin/env node
// Ops helpers: `node src/cli.js seed|review [YYYY-MM-DD]|export`
import { join, resolve } from 'node:path';
import { buildContext, ROOT, pickCoach } from './server.js';
import { makeAnnouncer } from './ha.js';
import { makeAuth } from './auth.js';
import { runWeeklyReview } from './api.js';
import { todayStr, weekStartOf } from './schedule.js';

const [, , cmd, arg] = process.argv;
const dataDir = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));

async function main() {
  const ctx = buildContext({ dataDir, coach: await pickCoach(process.env), announcer: makeAnnouncer({}), auth: makeAuth({}) });
  try {
    if (cmd === 'seed') {
      console.log(`program: ${ctx.program().name} (data: ${dataDir})`);
    } else if (cmd === 'review') {
      const weekStart = weekStartOf(arg ?? todayStr());
      const note = await runWeeklyReview(ctx, weekStart);
      console.log(`--- week of ${note.weekStart} ---\n${note.text}`);
    } else if (cmd === 'export') {
      console.log(JSON.stringify(ctx.repo.exportAll(), null, 2));
    } else {
      console.error('usage: node src/cli.js seed | review [date] | export');
      process.exitCode = 2;
    }
  } finally {
    ctx.repo.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
