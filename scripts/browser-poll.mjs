/** Await filesystem predicates between polls; this Playwright version treats a Promise as truthy. */
export const waitForBrowser = async (page, predicate, argument) => {
  const deadline = Date.now() + 30000
  do {
    if (await page.evaluate(predicate, argument)) return
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  throw new Error('Timed out waiting for browser filesystem operation')
}
