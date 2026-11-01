"""The fixed words the CLAP scores come from (docs/product/apps/MUSIC.md §9.1).

Each mood is scored 0-1 against the song's own average over the 16:
sigmoid(scale * (cos(audio, mood) - mean of cos(audio, every mood))), with `scale` the model's own
audio-text logit scale (about 18.7). So 0.5 is "as much as this song's moods on average", and the scores
say which feelings stand out in it; a plain "a piece of music" baseline was tried and set aside, since it
matches every song better than any mood does and pushed every score towards 0. Valence, arousal and
vocals are each a pair, scored the first prompt against the second; arousal is then averaged with the
signal's energy. The keys must equal MOODS in shared/contract/listen.ts, in the same order
(tests/jobs-audio.test.mjs). Changing a prompt changes every score: bump the analyzer VERSION with it.
"""

MOODS = {
    "calm": "calm, relaxed, gentle music",
    "peaceful": "peaceful, serene, tranquil music",
    "melancholy": "melancholic, wistful, bittersweet music",
    "sad": "sad, sorrowful, mournful music",
    "hopeful": "hopeful, uplifting, optimistic music",
    "joyful": "joyful, happy, cheerful music",
    "romantic": "romantic, tender, loving music",
    "nostalgic": "nostalgic, sentimental music that recalls the past",
    "dark": "dark, ominous, brooding music",
    "tense": "tense, suspenseful, anxious music",
    "energetic": "energetic, driving, high-energy music",
    "triumphant": "triumphant, heroic, epic music",
    "playful": "playful, whimsical, light-hearted music",
    "dreamy": "dreamy, ethereal, atmospheric music",
    "sacred": "reverent, sacred, worshipful music",
    "focused": "steady, unobtrusive music for focus and concentration",
}

VALENCE = ("happy, positive, bright, pleasant music", "sad, negative, gloomy, unpleasant music")
AROUSAL = ("energetic, intense, exciting, loud music", "calm, quiet, soft, sleepy music")
VOCALS = ("music with a singing voice and vocals", "instrumental music with no vocals")
