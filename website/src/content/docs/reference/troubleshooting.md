---
title: Troubleshooting
description: Diagnose loading, typing, matrix and algorithm errors without guessing at the runtime.
---

| Symptom | Check |
| --- | --- |
| WASM request returns HTML or 404 | Pass the emitted WASM URL explicitly in a bundle; inspect the response and MIME type |
| Missing function in the editor | Search the actual reference, including namespace moves and suffixed overload families |
| Native assertion failure | Verify the required dtype, channel count, dimensions and nonempty inputs for that exact overload |
| Unexpected red/blue swap | Distinguish native BGR/BGRA from canvas RGBA |
| Negative gradients disappear | Use a signed or floating destination before converting for display |
| Pixels change after another operation | A typed view may reference a grown heap or shared storage; copy retained values with `.slice()` |
| Transparent edges have a colour fringe | Premultiply before interpolation and resample colour and alpha together |
| The UI freezes | Move synchronous native work into an ES module worker |
| Memory grows every frame | Dispose every returned handle, including vector elements and handles inside result objects |
| Model loads but inference fails | Check model operators, input names, dimensions, layout and preprocessing |
| A tracker returns a plausible wrong location | Measure independent confidence and trigger re-detection when support is inadequate |

## Reduce to a concrete call

Record the exact function, overload, input shape, matrix type and smallest data example that reproduces the issue. Test the same algorithm on known synthetic input before blaming application data. For Python migration differences, compare intermediate arrays and masks so the first divergent operation is visible.

## Result fields and overloads

Scalar output arguments become named result fields. For example, `getTextSize(...)` returns a record whose `.value` is a size and whose `.baseLine` is a number. A returned native matrix inside a record still needs disposal.

The generated reference includes upstream comments. Some mention optional native backends that are not linked in this package; the [compatibility page](/reference/compatibility/) defines this build’s actual boundary.
