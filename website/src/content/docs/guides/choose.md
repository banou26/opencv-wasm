---
title: Choose an algorithm
description: A practical map from a computer vision problem to useful methods and their assumptions.
---

Choose the simplest model that describes the variation in your data, then test what happens when its assumptions fail.

| You want to… | Start with | Check first |
| --- | --- | --- |
| Reduce ordinary image noise | [Gaussian](/algorithms/gaussian-blur/) | Can you afford to blur boundaries? |
| Remove isolated specks | [Median](/algorithms/median-filter/) | Must thin lines survive? |
| Preserve strong boundaries while smoothing | [Bilateral](/algorithms/bilateral-filter/) or [guided filtering](/algorithms/guided-filter/) | Does the guide contain the right structure? |
| Separate a bright object | [Threshold](/algorithms/threshold/) | Is illumination uniform? |
| Segment under uneven lighting | [Adaptive threshold](/algorithms/adaptive-threshold/) | What neighbourhood captures illumination without following texture? |
| Count separate binary regions | [Connected components](/algorithms/connected-components/) | Are touching objects already separated? |
| Measure object outlines | [Contours](/algorithms/contours/) | Which boundaries and holes should count? |
| Find an unchanged patch | [Template matching](/algorithms/template-matching/) | Are scale and orientation stable? |
| Match a textured planar object | [ORB](/algorithms/orb/) or [SIFT](/algorithms/sift/), then [homography](/algorithms/homography/) | Is one plane a valid model? |
| Follow points between nearby frames | [Lucas-Kanade](/algorithms/optical-flow-lk/) | Are the patches visible and textured? |
| Estimate dense motion | [Farneback](/algorithms/optical-flow-farneback/) or [DIS](/algorithms/optical-flow-dis/) | How will you identify uncertain or occluded pixels? |
| Refine an existing alignment | [ECC](/algorithms/ecc-alignment/) | Is the initial warp close enough? |
| Estimate translation of the whole frame | [Phase correlation](/algorithms/phase-correlation/) | Does most of the content share one translation? |
| Read a marker or code | [ArUco](/algorithms/aruco/) or [QR](/algorithms/qr-code/) | Are the code’s cells resolved clearly? |
| Estimate known-object pose | [PnP](/algorithms/pnp/) | Are camera calibration and point correspondences correct? |
| Run a learned detector | [DNN](/algorithms/dnn-inference/) | Does the model’s operator set work in this build? |

## Evaluate the assumption, not just the output

A crisp mask may still identify the wrong object. A low alignment error may come from a repeated texture. A smooth depth map may contain invalid correspondences. Keep confidence, coverage and model fit separate from the visual attractiveness of the result.

Use a positive control that should succeed, a nearby difficult case and a case that should be refused. For image reconstruction, exclude genuinely unknown pixels from numerical error while reporting how many are unknown.
