-- Player pictures: one avatar and one banner per profile, stored as objects in
-- the zoi-media bucket and keyed by the player's slug.
--
-- Two timestamps rather than two URLs: the object's address is derived from the
-- slug and the kind, so it never has to be stored. The timestamp is what says a
-- picture exists at all, and it is also the cache-buster - a new upload moves the
-- stamp, the page asks for a new ?v=, and a browser that cached the old picture
-- goes and gets the new one. Replacing a picture overwrites the same object, so
-- nothing is left behind to clean up.

ALTER TABLE player_profiles ADD COLUMN avatar_at TEXT;
ALTER TABLE player_profiles ADD COLUMN banner_at TEXT;
