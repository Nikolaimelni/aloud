# Making a model that cannot stream look like it streams

Whisper reads a window of audio and writes the whole window out. There is no partial result,
no token you can take early, nothing that arrives while the sentence is still being said. It
is an encoder-decoder over a fixed thirty second window, and it was never meant for live use.

The live browser demos run it again and again over a window that keeps moving, and then
decide which part of each answer to believe. That second half is where all
the interesting problems are, and it is what this is about.

## Local agreement

The rule is almost embarrassingly simple. Run the model over the audio you have. A second
later, run it again over a window that now includes a bit more. Compare the two answers word
by word from the front, and everything they agree on is final. Everything after that stays
provisional and is allowed to change.

```
pass 1   And so my fellow
pass 2   And so my fellow Americans, ask not
         └──── agreed ────┘└── still a guess ──┘
```

That is it. Two passes agreeing is the whole confidence mechanism. It works because the
model's mistakes near the end of a window are mistakes of context: it has not heard the rest
of the word yet, or the rest of the clause. Give it another second of audio and it changes its
mind. Words it has already had enough context for do not move.

In the interface, the two halves must not look the same. Confirmed text is set in the body
colour and never moves again. The guess is set in amber and is rewritten two or three times
a second. If you show them identically, the reader watches the text twitch and does not know
which parts to trust.

## The latency arithmetic

Before measuring anything I wrote down a latency budget: capture buffer, voice detection,
inference window, and a line saying confirmed text lags by "one more window step". It was
wrong by a factor of four. The sums were right; the shape of the formula was wrong.

A word waits for a window step before a pass includes it. Then it waits for the pass. Then it
waits for the _next_ step, because agreement needs two. Then it waits for that pass as well.
The step is in the total twice.

```
lag ≈ 2 × (window step + pass time)
```

Measured on a laptop, whisper-base on WASM with a 1.5 second step: the confirmed text ran
three point nine to four point seven seconds behind the speaker.

The obvious lever is the window step, and it does not work the way you would hope. I tried
2.2 seconds expecting the queue to drain and the lag to fall. The lag got worse, to 5.3
seconds, because the step is the part you pay for twice.

Making the step smaller does not work either, and this is the part that surprised me most.
Whisper's encoder pads every window to thirty seconds of mel spectrogram regardless of how
much audio is actually in it. A pass over two seconds of speech and a pass over eleven cost
almost the same:

| Audio in the window | Inference |
| ------------------- | --------- |
| 2 s                 | 1.3 s     |
| 5 s                 | 1.4 s     |
| 11 s                | 2.1 s     |

There is a fixed second in there that no window size gets you out of. That fixed second is the
floor under the step, and it is why getting this to a one second lag needs a smaller model or
a faster machine rather than a better setting.

## Silence is not empty

Point Whisper at a room where nobody is talking and it does not return nothing. It returns
fragments of its training data. "Thank you for watching." "Subtitles by the Amara community."
Whatever it saw most often over quiet audio.

This is not a rare edge case you can leave for later. It is the first thing anyone will see,
because the first thing anyone does is open the page and not say anything.

The fix is voice activity detection in front of the model, and its job is narrower than it
sounds. The stabiliser already cuts windows between words it has confirmed, which beats any
boundary a detector could offer, so the detector only decides whether the model runs at all.
Silero VAD in a worker, two megabytes, thirty-two millisecond blocks, and two thresholds
rather than one so it does not chatter on every breath, plus a hangover so a pause between
words is not read as the end of speech.

That decision has to hold at the end of a session as well. The first version flushed
whatever audio was left when you pressed stop, so a session nobody spoke in still ended with
the model's opinion of silence, confirmed and saved.

## Decoder loops

The other failure mode is louder. Give the model audio it cannot make sense of and it can fall
into a repetition and never come out. One six second Russian clip in the benchmark produces
this from whisper-tiny:

> Нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, нет, ...

One hundred and ninety-six times. Eleven hundred characters for a clip whose reference
transcript is twenty-six words. The word error rate is 854 percent, which is a perfectly
legitimate number: the model invented seven times more words than were said.

What makes it interesting is that the audio really does open with someone saying "не" five
times over. The model latched onto a genuine repetition and could not let go.

The stabiliser cuts this back, and because the benchmark can run the same clip both ways, the
value of that is measurable rather than asserted:

| ru-03, whisper-tiny | one pass | through the stabiliser |
| ------------------- | -------- | ---------------------- |
| word error rate     | 853.8%   | 96.2%                  |
| characters out      | 1109     | 7                      |
| cost                | 2.1-2.5x | 6.1-7.8x               |

It does not rescue the content. The model genuinely cannot transcribe this clip at that size.
What it does is turn a page of noise into an obviously empty answer, which is the better way
to be wrong: a reader can see that nothing was understood.

The trimming only ever looks at the end of a hypothesis. That is deliberate, because the tail
is where the failure lives: a decoder that has come off the rails never stops, so the repetition is always
at the tail. A repetition in the middle of a sentence is somebody talking and is left alone.
The price is that a genuine repetition ending a window gets cut too, and there is no way to
tell them apart from the text.

Look at the cost column as well. When the model loops, every window loops, and the streaming
pipeline burns six to eight times real time producing nothing. Whatever interface sits on top of
this needs to notice that and say so, rather than looking busy.

## The cut that ate a word

One more, because it took a while to find and the symptom was strange.

Once text is confirmed you can stop carrying the audio behind it, which keeps the window from
growing without bound. The obvious place to cut is exactly at the start of the first word you
are still unsure about. Do that and the model starts mishearing that word, every time. In
testing, "my fellow Americans" reliably lost "Americans".

A word arriving with nothing in front of it is a word without its run-up: no coarticulation
from the previous syllable, no room tone, nothing. So the cut keeps four hundred milliseconds
of audio behind the boundary. Most of what the model hears again in that margin falls to the
timestamp filter that was already there. The word straddling the boundary can come back with
its end time late enough to slip past, so it is also compared with the last confirmed word
and dropped when they match.

## What I actually got wrong

Mostly the measurements.

The word error rate was wrong twice, and both times the scoring was at fault rather than the
model. First it counted "Mr." against a reference reading "MISTER" as an error, which on a
seventeen word clip is six percent of the score. Then it counted "50" against "пятьдесят".
Whisper evaluations live or die on text normalisation, and a word error rate quoted without
saying which normaliser produced it is not a number.

The offline test failed twice as well, both times because of the test. Once from a header I
had invented for the test harness and the application never sends. Once from cutting the
network before the service worker had finished filling its cache, so the page came back with
nothing behind it.

If I did this again I would write the scorer and its tests before the thing being scored, and
I would treat a surprising measurement as a suspect measurement before treating it as a
finding. Three of the four surprises in this project turned out to be the ruler, not the thing
being measured.

## Where it leaves you

On the laptop this was built on, English works: read speech and speech to a crowd both come
out word for word at whisper-base, streaming at around real time with a four second lag.
Spontaneous Russian over a phone-quality line is a median nineteen percent wrong at base, and
the model that fixes it costs nearly three times real time, which puts live Russian out of
reach here entirely.

Which is a fine place to end up, as long as you say so. The numbers are in the repository, the
harness that produced them runs with one command, and the fixtures are listed in a JSON file
that anyone can add to.
