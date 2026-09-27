import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKickUserProfile } from "./kick-oauth-http.js";

test("Kick profile mapping saves https avatar and rejects invalid URL", () => {
  const parsed = parseKickUserProfile({
    data: [
      {
        user_id: 42,
        name: "kickuser",
        display_name: "Kick User",
        profile_picture: "https://images.kick.com/a.png",
      },
    ],
  });
  assert.equal(parsed.kickUserId, "42");
  assert.equal(parsed.username, "kickuser");
  assert.equal(parsed.displayName, "Kick User");
  assert.equal(parsed.avatarUrl, "https://images.kick.com/a.png");

  const rejected = parseKickUserProfile({
    data: [{ user_id: "k2", name: "x", profile_picture: "http://evil.test/x.png" }],
  });
  assert.equal(rejected.kickUserId, "k2");
  assert.equal(rejected.avatarUrl, undefined);
});
