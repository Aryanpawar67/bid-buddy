# Note: Role Selection at Signup

**Date:** 2026-06-05
**Status:** Needs brainstorm session before implementation

## The Ask
During signup, ask the user to select their role:
- Presales / Bid Analyst
- Sales
- Marketing

## Open Questions
1. Do these replace or augment existing roles (`pre_sales`, `legal`, `finance`, `admin`)?
2. Do all three map to the same access level as `pre_sales`, or do Sales/Marketing get a restricted view?
3. Is `admin` still manually assigned (not selectable at signup)?
4. Does this require a new `app_role` enum value, or are these UI labels mapped onto existing roles?
5. What does the onboarding UI look like — step in the auth flow, or a post-signup screen?
