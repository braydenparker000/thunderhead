# The plan (lead, 2026-11-01)

The owner wants to enjoy the Thunderhead, not run it. This page is the lead's read of what they
want and how to get there. Work arrives as pull requests; the owner tries them and merges what they
like. Nothing goes live without that.

## What the owner wants (from their own words)

1. **Music that just works.** It plays the moment you tap, never stops, skips instantly, survives the
   screen going off, and the AirPods and lock screen always answer. Highest quality, nothing downloaded
   in full: 15 s buffered ahead, the first 15 s of the next three songs ready.
2. **Music and the Thunderhead as one.** Open Music without leaving the chat. "Pause", "skip", "who is
   this?", "more like this", "never play this again", "play until I fall asleep".
3. **Recommendations that feel right.** The Thunderhead recognises the feeling of a song and picks
   better ones.
4. **A beautiful, calm app.** Good type, a ring that's quick to use, motion that feels alive, no
   standing "all is well" noise; cards only when something matters.
5. **Less managing.** Try things, say yes or no. Short, plain updates.
6. **The rest of life:** Podcasts that remember where you were on any phone, Guitar practice that
   climbs, dictation, reminders and quiet that follow your own clock.

## Where it stands

Done and live: dictation; phone commands (open an app, remind me, pause, skip, previous, sleep timer,
never play this again); the catch-up line; Guitar's tempo ladder; the island (Music and Podcasts open
inside home and keep playing as a small pill at the top); playback reports and the database guard;
what plays and what is skipped reaches the mind; the streaming engine and its test page
(`/lab/stream/`).

Found tonight: the Thunderhead ran on UTC, three hours off (PR "runs on your own time zone").

## How to make it the best possible

1. **Try before it ships.** Every pull request gets its own copy of the site to open on the phone
   (preview builds). One owner step: a Cloudflare token for it. This is what makes "product enjoyer"
   real: tap a link, try it, merge or not.
2. **Music that just works:** the new streaming engine inside the player, song by song, falling back
   to today's playback on any trouble, measured by the playback reports already live, so problems
   show up in numbers, not only on the phone.
3. **Music that knows you,** in two layers:
   - *What the mind knows* (no new keys): each night it tags about a thousand songs with moods,
     occasions, era and themes; "who is this?", "more like this", "something calm", a couple of mixes
     a night with a reason, and "never" that lasts.
   - *How each song sounds* (needs one read-only key from the owner): tempo, key, energy and 16 mood
     scores measured from the audio, and each song's closest-sounding songs. With both, the DJ flows by
     feeling, tempo and key, and energy follows the time of day.
4. **The island everywhere it helps:** Guitar's metronome and practice timer, the sleep timer showing
   on the island, sideways swipes.
5. **Podcasts across phones:** where you were in each episode follows you; new episodes in the
   morning card.
6. **Fewer rules, more product.** A one-page rulebook (AGENTS.md); the long specs stay as reference,
   not law; the carried-over apps are our code now (no more byte-for-byte records); second readers
   only for sign-in and stored data.

## Owner choices that would remove work (none is required)

- **Workers Paid, $5 a month:** the daily database limit stops being a worry.
- **A private repository:** less caution in every change.
- **The read-only music key:** unlocks "how each song sounds".
- **A Cloudflare token for previews:** unlocks trying every change on the phone first.
