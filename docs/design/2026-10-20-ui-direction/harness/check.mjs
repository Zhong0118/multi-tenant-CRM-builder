// Shared assertions for the browser harness. Every important result goes
// through check(); a failed check prints FAIL and makes the process exit 1, so
// a run that exits 0 means every check passed.
export function createChecks(label) {
  const failures = [];
  let total = 0;
  function check(name, ok, detail) {
    total += 1;
    const suffix = detail === undefined ? '' : ` (${JSON.stringify(detail)})`;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${suffix}`);
    if (!ok) failures.push(name);
  }
  function finish() {
    if (failures.length) {
      console.error(`${label}: ${failures.length}/${total} checks failed: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(`${label}: all ${total} checks passed`);
    }
  }
  return { check, finish };
}

// Runs the flow, always closes the browser, and turns a thrown error (for
// example a waitFor timeout) into a failed run instead of a hang or exit 0.
export async function run(label, browser, flow) {
  const checks = createChecks(label);
  try {
    await flow(checks.check);
  } catch (error) {
    checks.check(`flow completed without error`, false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    await browser.close();
    checks.finish();
  }
}
