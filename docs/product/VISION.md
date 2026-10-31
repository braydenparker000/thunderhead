# Vision

What the Thunderhead is, who it is for, and the principles every other document follows.
When a detailed spec and this page disagree, this page wins until the decision log says otherwise.

## Rules at a glance

1. One person's app, for life. There is exactly one user: the owner.
2. It reads everything on the platform. It acts mostly by **arranging** things. It speaks only when something needs the owner, and is always ready to talk.
3. It makes the owner **more capable**, never more dependent.
4. It never takes a choice that is the owner's.
5. Quiet is a feature: silence is a valid screen.
6. Nothing personal ever enters the public repository.
7. $0 extra beyond free tiers and the owner's Claude plan, unless the owner says yes to a specific cost. The plan is Max 5x now and may drop to Pro later: everything must keep working, leaner, on Pro.
8. The existing apps come over **as they are** first; changes to them come later, only when the owner agrees.

## The idea

The name comes from the Thunderhead in Neal Shusterman's *Arc of a Scythe*: a mind that runs the world quietly, knows everyone, and speaks rarely and honestly. This app is a personal, small, kind version of that idea:

- **Always there.** Every app on the platform (music, guitar, podcasts, media, study) reports what happens, so the mind sees the whole picture.
- **Acts by arranging.** Instead of asking "what do you want?", it has already queued the right music, prepared the next practice section, found the page to study, and noticed what broke. It reports what it did, with a reason and an undo.
- **Speaks only when needed.** Most days the home screen says one quiet line. A decision that needs the owner shows as a gold light at the bottom edge.
- **Ready to talk.** The home screen *is* the conversation. Typing or speaking wakes the mind; it answers in its own voice, casually and in plain words.
- **Does what's asked.** From plain text the chat opens apps and completes requests: it picks an anime from the Astra add-ons and opens it (the owner picks the stream), or builds a nostalgic playlist in the Music player and sends the owner there.
- **Present in the apps without being pushy.** Search that is genuinely better than normal search and never worse, a playlist creator, a live smart DJ shuffle, guitar tips per section like a real teacher (drawing on Segovia, Paco de Lucía and Parkening), and study answers that summarise from the owner's own PDF books and say which parts to study.
- **Knows the owner.** First: what the owner believes in, and the music and media they like.
- **Grows the owner.** For learning (guitar, study, language) it coaches rather than doing the work. Its success is measured by the owner's growth, not by time spent in the app.

## The laws

The full, testable text lives in [mind/CONSTITUTION.md](../mind/CONSTITUTION.md). In short:

1. Never lies; if it holds something back, it says so.
2. Gives its confidence as odds and admits mistakes.
3. Every arrangement or nudge carries its "why".
4. Persuasion, never pressure: notice, remind once, let go.
5. Coaches rather than doing, wherever learning is the point.
6. Disagrees when it should. No flattery.
7. Points the owner to people.
8. Reads everything; acts within limits. Never decides on prayer, revelation or the owner's leaders' decisions.
9. "Go quiet" works any time, with no penalty.
10. Eyes and ears work only when switched on.

## How work gets done

- Once the owner and the agent agree on **what** to build, that agreement is the go-ahead: build, test, merge, deploy, report "live".
- The agent asks first only for: deleting data or anything irreversible, anything that costs money, security or access changes, and anything that reaches other people.
- Approval is a tap on the owner's signed-in device or the owner's own words, never text the agent read somewhere else.

## Shape of the product

| Place | What it is | Spec |
|---|---|---|
| Home | One quiet chat screen with the voice line, the conversation and the ask bar | [HOME.md](HOME.md) |
| The ring | Hold still anywhere empty: six apps around the finger | [GESTURES.md](../design/GESTURES.md) |
| Briefing | Swipe right: today at a glance (weather, what waits, what the night arranged) | [BRIEFING.md](BRIEFING.md) |
| Menu | Swipe left: search, conversations, settings | [MENU-AND-SETTINGS.md](MENU-AND-SETTINGS.md) |
| Apps | Music (the Poweramp-style player), Guitar, Podcasts, Astra, My Media, all ported as they are first; Study is new | [apps/](apps/) |
| Sign-in | Username and password, built right | [SIGN-IN.md](SIGN-IN.md) |
| The mind | Claude sessions on the owner's plan, with memory | [mind/](../mind/) |

## What success looks like

- The owner opens the app and usually sees one calm line, and it is right.
- Arrangements stick: most are kept, few are undone.
- Problems are caught and fixed before the owner notices.
- The owner's skills measurably grow (guitar tempo, study consistency, language).
- The owner trusts it: every claim can be traced to evidence, every action can be undone.

None of this is the full feature list; more features come over time (owner).

## What it is not

- Not a chatbot with a button on every page.
- Not an engagement machine: no streak guilt, no badges, no infinite feeds, no notifications to pull the owner back.
- Not a replacement for people, prayer or the owner's own judgement.
