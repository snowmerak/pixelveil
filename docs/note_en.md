# Notes

## Overview

### Introduction

This project is a web app that processes webcam frames in real time, finds the objects you describe, and mosaics them. Beyond the app itself, the goal is to build technical and experimental know-how for applying policies dynamically and in real time, whether for live streaming, on-demand video, or plain image serving.

The project explores a few ideas:

- **Jev**: it recently gained the ability to return a bounding box from an image. This looked like the easiest thing to integrate.
- **Qwen3-VL**: a relatively heavy VLM. In past experiments, `qwen3-vl-reap-24b-a3b` showed fairly good vision performance.
- **EmbeddingGemma 2**: a recently released embedding model that now accepts images. Jev can return boxes, but a second useful role is deciding *whether the object is present at all*. I wanted to see how well EmbeddingGemma 2 handles that.

### Basic setup

- The app is built with Vite + React, to keep the implementation minimal and to make it easy to try many approaches as proofs of concept.
- A single `Processor` interface comes first, with a `process(frame, objectDescription) → frame` method. It takes a frame, updates its internal state, and returns the frame with the appropriate regions mosaicked.
- The React page reads webcam frames in real time, calls this interface continuously, and renders the result on a separate canvas.
- A dropdown selects the `Processor` implementation. When it changes, the new processor takes over from the next frame.

## Implementation

### Jev

Jev 1.14 added the Box question type. You register the image as an asset, reference it from the state, and ask a question about it.

```
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "TypeSafe-Danger-Zone-Images: true" \
  -F 'request={
    "model": "jev-preview",
    "state": {"photo": "6e1d0b7c-kitchen"},
    "assets": {"6e1d0b7c-kitchen": {"type": "image", "part": "kitchen-photo"}},
    "questions": {
      "mug": {"type": "box", "instructions": "the coffee mug in `photo`"}
    }
  };type=application/json' \
  -F 'kitchen-photo=@kitchen.jpg;type=image/jpeg'
```

A request looks like the above, and the expected response looks like this:

```
{
  "model": "jev-1.14.0",
  "answers": {
    "mug": {
      "type": "box",
      "box": { "top": 0.25, "bottom": 0.82, "left": 0.44, "right": 0.84 },
      "confidence": 0.92
    }
  },
  "usage": {"input_tokens": 290, "output_tokens": 21}
}
```

This is probably the easiest approach available today. It has one drawback: Jev 1.14's Box question returns **exactly one** bounding box. If you ask it to mosaic every pen in view, only one pen gets covered.

#### Jev v1: Simple decision

##### Idea

This processor sends a single Box question and mosaics the returned region.

> Because of Jev's network latency, while one frame is being processed, any new frames are dropped as detection candidates. I would have preferred to cover everything faster than a human can perceive, but research shows people can extract meaning from an image shown for only 13 ms. So I accepted latency as the limiting factor, and the last box stays in place until the next detection completes.

##### Results

It was slower than I hoped, but it worked. Statistics over 200 samples:

| Percentile | Latency |
|---|---|
| p50 | 502 ms |
| p90 | 687 ms |
| p99 | 865 ms |

The worst case was about 1.2 s, but most detections finished within 865 ms. At 60 fps (about 16 ms per frame), that means around 54 frames pass without a chance of being detected. That is fine for preprocessing on-demand video, where each frame has plenty of time, but on its own it falls well short of real time.

#### Jev v2: Scroll decision

##### Idea

This version tests whether Jev can handle multiple objects at all.

> From 1.14, image input is not limited to the Box question. Noul, Choice, Score and the other question types accept images too.

Jev reportedly performs on par with GPT 5.6 Terra on benchmarks, so I tried the following:

- Ask a Choice question for how many target objects are in the frame (assuming at most 6).
- Ask Box questions for the N-th object, ordered from top-left to bottom-right.
- Combine the two to mosaic up to 6 objects.

###### Improvements

It worked, but asking both questions made latency too long. The simplest fix: if the previous frame found N objects, the next request asks for N+1 boxes instead of re-counting. Each request also asks whether the (N+1)-th object actually exists, so the count for the current frame stays up to date. The trade-off is that when several objects appear at once, it takes several cycles to cover all of them.

##### Results

These results include the improvement above. Detection and mosaic quality were not good. Testing with two pens, the three outcomes (one pen covered, both covered, or one large box spanning both) occurred at roughly equal rates. The initial count question also added noticeable latency at startup.

| Percentile | First few seconds | After |
|---|---|---|
| p50 | 504 ms | 495 ms |
| p90 | 783 ms | 617 ms |
| p99 | 1,234 ms | 894 ms |

#### Jev v3: Panning decision

This is a simplification of v2. Every request asks for six Box questions up front, instructing the model to fill in only matching regions and to return an all-zero box when there is no match. I also intended to tune confidence so that a box is accepted as soon as it meets a minimum bar.

##### Improvements

**Confidence.** Initially, only the Noul (presence) question had a confidence threshold in all three versions. Along the way I added and tuned a threshold for Box confidence as well:

1. No threshold in any version.
2. Panning only: 0.5 or higher.
3. Panning relaxed to 0.2.
4. Simple and Scroll also set to 0.2.
5. All three relaxed to 0.15.
6. Scroll further relaxed to 0.1.

I started this because in v2 the large box spanning both pens came with relatively low confidence, and I wanted to filter it. But my laptop camera then failed to detect pens reliably, so I lowered it back to 0.1, at which point the spanning box could no longer be avoided. **A fixed threshold alone could not decide whether an object is present.**

**Presence.** The confidence of the boxes that should have been all-zero varied a lot depending on whether the object was in the frame. With pens: when no pen was present, the zero boxes came back above 0.15; when a pen was present, the pen scored above 0.2 and the rest scored 0.1 or lower. So I later added a Noul question to v3.

**Overlap.** Even so, I could not control whether a box spanning both pens came back. It kept appearing and disappearing, which made it hard to separate by score. So the processor now takes all six boxes, mosaics independent boxes as they are, and for boxes that contain or overlap each other even slightly, keeps the smaller one.

##### Results

This was much better than Scroll decision, though not better in every case: if the model fails to identify a small part of the object, the mosaic can still miss it. Latency was similar to the other Jev processors.

| Percentile | Latency |
|---|---|
| p50 | 529 ms |
| p90 | 700 ms |
| p99 | 980 ms |

At this point it seemed clear that, unless Jev itself supports multiple boxes per question, post-processing would only get more cumbersome. Splitting the image into tiles and merging per-tile results is another known option, but it multiplies the number of requests (and latency), and tiles can still contain several objects, which makes things harder rather than easier. I left it out of this project.

#### References

- [Jev Box Primitives](https://docs.typesafe.ai/primitives/box)
- [Jev Images Doc](https://docs.typesafe.ai/images)
- [Detecting meaning in RSVP at 13 ms per picture](https://link.springer.com/article/10.3758/s13414-013-0605-z)
- [Introducing System One Models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [N8 Programs's Jev benchmark vs GPT 5.6 Terra](https://x.com/N8Programs/status/2100088523403432357)

### VLM

This is the more traditional approach: send the image with a prompt asking for bounding boxes, and receive them as structured output. There was no guarantee it would be faster or more accurate than Jev, but it was worth trying. I tested `qwen3-vl-reap-24b-a3b`, `qwen3.6-35b-a3b-ud-mlx`, `gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp`, and `minicpm-v-4.7-1b@f16`, all served from a Mac Studio I have access to.

#### Simple detection

##### Idea

The goal was to see how fast and accurate VLMs are. The processor reuses the same flow as Jev and only swaps out the part that obtains the boxes. The web UI lets you pick one of the four models.

##### Results

None of them reached 1 FPS. Even MiniCPM, the smallest at 1B parameters, took a little over a second, which is unusable for real time. The other three framed objects correctly, while MiniCPM sometimes covered only part of an object (for example, half of it).

| Model | Mean (s) | p50 (s) | p90 (s) |
|---|---:|---:|---:|
| Qwen3-VL REAP | 2.38 | 2.33 | 2.94 |
| Qwen3.6 | 1.95 | 1.94 | 2.13 |
| Gemma4 | 2.02 | 1.99 | 2.23 |
| MiniCPM | 1.34 | 1.27 | 1.77 |

In short, VLMs are at a disadvantage for real-time use. However, Gemma4 26B, Qwen3-VL REAP and Qwen3.6 35B were more accurate than Jev, so they look perfectly usable for non-real-time data. For real time, the better direction seems to be minimizing calls to a type-decision model like Jev, or running the VLM on faster inference hardware if available.

#### References

- [qwen3-vl-reap-24b-a3b](https://huggingface.co/mradermacher/Qwen3-VL-REAP-24B-A3B-GGUF)
- [qwen3.6-35b-a3b-ud-mlx](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit)
- [gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp](https://huggingface.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP)
- [MiniCPM-V-4.7-1B-gguf](https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf)

### Embedding

From here on, the work moves a step away from the mosaic itself: before processing a frame, check whether it is worth requesting boxes for it at all.

#### Idea

If we can tell that a frame does not need checking, we can skip the inference entirely. EmbeddingGemma 2 is small enough to run locally in the browser and reasonably fast, so it looked like a good fit for filtering frames with minimal delay and cutting unnecessary requests.

However, my laptop (Snapdragon X Plus) is on the WebGPU block list, so this time I used an external API instead. The pre-check can be toggled in the UI, and latency is measured for both the embedding call and the comparison. When enabled, each cycle adds these steps:

1. Embed the object description and keep it in memory.
2. Embed the frame to be checked.
3. Call the `Processor` only if the vector similarity is at or above a threshold.

#### Results

After a few tests I settled on a default threshold of 0.65. The embedding turned out to be quite sensitive. In my setup (pens and a smartphone), 0.65 was enough, but real use will likely need some tuning. The statistics below were collected with EmbeddingGemma 2 enabled together with Panning decision.

| Stage | p50 | p90 | p99 |
|---|---:|---:|---:|
| Embedding pre-check | 307 ms | 400 ms | 606 ms |
| Jev HTTP request after passing | 483 ms | 664 ms | 1,090 ms |
| Total detection incl. embedding | 888 ms | 1,113 ms | 1,457 ms |

Since this only adds a similarity check in front, it does not make individual detections faster.

| Item | Count | Rate |
|---|---:|---:|
| Jev calls skipped by the embedding check | 55 / 123 | 44.7% |
| Noul said "absent" after passing the check | 1 / 68 | 1.5% |

Of the 68 frames that passed the check, Panning decision's Noul judged the object absent only once (1.5%). I watched the screen during the test for the 55 frames that were filtered out, and saw no case where an object was present but filtered. In other words, about 45% of Jev calls were skipped without missing anything. With pens and a smartphone, a threshold of 0.65 gave the filtering I wanted; other environments can start from this value and adjust.

#### References

- [embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2)

### Video

This part has nothing to do with AI. It is plain video processing.

#### Idea

If we track the features inside a bounding box and keep moving the mosaic to wherever those features go in the next frames, the mosaic can follow slowly moving objects until the next Jev result arrives. I had never implemented this before, so there were a few things to learn first.

```
process(
  frame: CapturedFrame,
  object: string,
): ProcessedFrame | null;
```

First, the return type changes. The returned object now also carries when the frame was captured and which boxes it contains, so we know which regions of the mosaicked frame were modified.

> In a more conventional pipeline, `process` would return only the boxes and the mosaic would be applied outside. It was implemented this way first, and the mosaic code itself is already separate, so I kept the change minimal.

Next, we need an algorithm that picks distinctive regions in each frame and follows where they move. Without WebGPU, it had to work without models or deep learning. Fortunately, Lucas–Kanade optical flow is a textbook algorithm, and OpenCV.js provides an implementation, so I chose it.

##### Lucas–Kanade optical flow

Lucas–Kanade optical flow (LK) was proposed by Bruce Lucas and Takeo Kanade in 1981. It tracks where a distinctive point in one frame moved to in the next, expressed as a motion vector.

As I understand it, the starting point is the motion of a single point. To track it, LK looks at how brightness changes horizontally and vertically within the 2D pixel data, and how the brightness at that point changes over time. From these, it estimates where the point is in the next frame.

There is a catch: for a single point, combining the horizontal, vertical and temporal brightness changes gives one equation with two unknowns, so many motions fit equally well (the *aperture problem*). A single pixel is not enough to determine which one is right. LK therefore assumes that a small patch of pixels around the point moves in nearly the same direction and speed. With a whole patch, it becomes much easier to determine where the feature moved.

The code uses Shi–Tomasi and Pyramidal Lucas–Kanade. Shi–Tomasi decides which points inside the box LK should track, and the pyramidal variant reduces errors that grow with the size of the motion between frames.

Shi–Tomasi is a feature detector based on brightness patterns. It looks at horizontal and vertical brightness changes within a region and picks points where **both** directions change enough. Take an iPhone: unless the background has nearly the same color, the corners of the black screen or of the colored back panel will show strong horizontal and vertical changes. Such corners usually sit on the object's boundary.

Pyramidal Lucas–Kanade addresses errors over long distances, which come from LK's first-order Taylor approximation. LK only accounts for linear brightness changes, but real brightness distributions are not linear: moving from one point to another within the same frame, brightness does not simply keep increasing or decreasing. The actual change includes higher-order terms, but LK keeps only the first-order term and discards the rest.

So plain LK becomes inaccurate as the motion gets larger. To fix this, the frame is downscaled so that the motion looks small, the position is roughly located, and then the estimate is refined while scaling back up. Because each level only has to solve the small remaining motion, the first-order approximation is valid again at every level, even when the object moved fairly far.

#### Results

For slowly moving objects, the results were quite good. The mosaic followed well, and I saw no delay from the tracking in my setup. Most frames were processed within 5 ms; occasionally it took longer, but still within an acceptable 7 ms.

| Percentile | Processing time |
|---|---|
| p50 | 4 ms |
| p90 | 5 ms |
| p99 | 7 ms |

During testing I found one limitation. Jev's Box question returns an axis-aligned rectangle. If you hold a smartphone at an angle, the box also captures more background; a pen held at 45 degrees ends up with more background than pen inside the box.

Shi–Tomasi is configured to extract up to 32 feature points per box. The corners of the phone or the tip of the pen naturally become tracking targets, but unless the background is completely plain, background points get picked up too. Forward-backward checks and outlier rejection are already in place, but when background points make up a large share of the box, the estimated motion (which includes scale) is still pulled off. As a result, even with slow movement, the mosaic sometimes grew larger and then shrank back to normal once the next Jev response arrived. This mainly calls for more precise boxes, so I did not improve it further this time.
