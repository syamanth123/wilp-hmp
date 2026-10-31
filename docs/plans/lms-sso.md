# Plan — Taxila (Moodle) read integration, publish "Mode C", BITS SSO

Branch `feature/lms-sso` (off `feature/handout-editor-ux`). Rules: no merge, no deploy, no real
calls to Taxila or the BITS IdP from tests or CI, no secrets in git. Code starts only after this
plan is approved.

## 0. Inputs — what's here and what isn't

| Input                                                | Status                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAXILA_WS_TOKEN` in `C:\work\wilp-hmp\.env`         | **Not there yet.** Not needed to write the code (tests use saved responses), only for the admin check page on the laptop.                                                                                                                                                                                                                                             |
| Our SP metadata `local-data/sso/hmp-sp-metadata.xml` | **Not there yet — the SP check below is blocked.** Nothing about it can be confirmed until the file is saved.                                                                                                                                                                                                                                                         |
| BITS IdP metadata (public)                           | Read on 2026-10-31. EntityID `https://idp.bits-pilani.ac.in/idp/shibboleth`. SSO endpoints for HTTP-Redirect and HTTP-POST. One certificate, `CN=idp.bits-pilani.ac.in`, valid to 14 Jul 2034. Its `KeyDescriptor` has no `use=`, so it is used for signing **and** the IdP may encrypt assertions to us. NameID formats: transient (and the old Shibboleth 1.0 one). |
| eLearn SP metadata (public, reference)               | HTTP-POST ACS; `AuthnRequestsSigned="true"`, `WantAssertionsSigned="true"`; transient NameID; requests `uid`, `mail`, `cn`, `employeeType`.                                                                                                                                                                                                                           |

**SP metadata check (runs first, the moment the XML is saved).** HMP's SAML settings will be
read _from that file_, not typed in by hand, so the two can't drift. Before writing any SSO code
I will check and report:

1. `entityID` — an https URL on the live HMP domain (not `localhost`, not an IP, not `http`).
2. `AssertionConsumerService` — exactly one, `Binding` = HTTP-POST, `Location` = `https://<live
domain>/api/auth/saml/acs`. If the path differs I will make our route match **their** path
   rather than ask IT to re-register.
3. A signing certificate present, not expired, and that we hold its private key (the key must
   match; I will compare the public keys, never print the private key).
4. Whether the certificate is marked `use="signing"` only. If it has no `use`, the IdP may encrypt
   assertions to it — supported (we decrypt with the same key), noted.
5. `AuthnRequestsSigned` / `WantAssertionsSigned` — whatever the file says is what HMP does.
6. NameID format (transient expected) and requested attributes (`mail`, `uid` at least).

If anything is wrong (localhost, http, missing or expired certificate, no ACS) I stop and tell
you **before IT registers it**.

## A. Taxila (Moodle) read integration

**Module** `packages/integrations/src/moodle.ts`:

- Settings from env only: `TAXILA_WS_URL` (default
  `https://taxila-aws.bits-pilani.ac.in/webservice/rest/server.php`), `TAXILA_WS_TOKEN`.
- Every call: `POST` with `application/x-www-form-urlencoded` body
  `wstoken=…&wsfunction=…&moodlewsrestformat=json&…` — **the token is only ever in the POST
  body**, never in a URL, never logged; error objects and logs carry a redacted copy of the
  request.
- 15 s timeout (AbortController). Moodle answers errors with HTTP 200 + `{exception, errorcode,
message}`; mapped to plain English: `invalidtoken` → "The Taxila connection key is not valid";
  `accessexception` / `webservice_access_exception` → "The Taxila key isn't allowed to do this
  (ask IT to add the function)"; `invalidrecord` → "Not found on Taxila"; network/timeout →
  "Taxila didn't answer in time"; anything else → "Taxila returned an error (code …)".
- Wrapped functions:
  - `findUserByEmail(email)` → `core_user_get_users` (criteria `email`), returns
    `{ id, fullname, email }` or null.
  - `coursesForUser(userId)` → `core_enrol_get_users_courses`, returns `{ id, shortname,
fullname }[]`.
  - `courseEnrolment(courseId)` → `core_enrol_get_enrolled_users` with the `userfields` option
    (`id,fullname,email,roles`) and returns **only** `{ studentCount, instructors: { name,
email, role }[] }`. Students are counted (role shortname `student`) and discarded in memory.
  - `siteInfo()` → `core_webservice_get_site_info` (connection check: "Connected as …" + the
    list of functions this key may call).
- Cache 10 minutes, keyed by function + arguments, holding **only the reduced results above**
  (never a raw response with student data). Redis when `REDIS_URL` is set, in-memory otherwise.
- Unit tests with saved fake responses (`packages/integrations/src/__fixtures__/moodle/*.json`):
  success, Moodle exception, timeout, the token never in a URL or log, cache hit, students never
  in the result.

**Data (new tables only, hand-written migration as before; no existing column changes):**

```
TaxilaCourseLink   termId, courseCode (normalized), taxilaCourseId, taxilaShortname,
                   taxilaFullname, confirmedById, confirmedAt     @@unique(termId, courseCode)
TaxilaEnrolmentSnapshot  linkId, studentCount, instructors Json (name, email, role),
                   fetchedAt                                      (latest per link; optional
                   — only if we want the numbers without hitting Taxila on every page view)
```

**Uses**

1. **IC links each Dibba course to its Taxila course** (Course Dibba → term → new "Taxila links"
   page). The three functions can't search courses by code, so suggestions come through people:
   for each Dibba course, look up its instructors (HMP faculty + the faculty-sheet emails) on
   Taxila, list their Taxila courses, and propose those whose shortname/fullname contains the
   course code (normalised the same way as the catalogue). The IC picks one (or pastes a Taxila
   course URL / id) and confirms; only then is a `TaxilaCourseLink` written. A
   `core_course_get_courses_by_field` / search function from IT would make this one step (§F).
2. **IC/HOG course row**: Taxila student count and Taxila instructors next to the Dibba numbers,
   with flags: student count differs from the Dibba total; a Dibba/HMP instructor not enrolled as
   a teacher on Taxila; a Taxila teacher not in HMP. Fetched on demand ("Check against Taxila"
   button per course and a "Check all" for the term), cached, never on plain page load.
3. **Faculty My Schedule**: "Open in Taxila" (`https://taxila-aws.bits-pilani.ac.in/course/view.php?id=<id>`)
   on each linked course.
4. **Admin → Taxila connection** (read-only page): "Connected as <name>" + allowed functions, or
   the plain error. Never shows the token or its length.

**Privacy:** stored — Taxila course ids/names, counts, instructor names and emails. Never stored
or shown — any student's name, email or id.

## B. Publish into the IC's Taxila folder — "Mode C" (built, upload stubbed)

- **Recording the folder:** on the Taxila link the IC pastes the folder's URL
  (`…/mod/folder/view.php?id=<cmid>`); HMP stores the course-module id in a new column of the
  **new** `TaxilaCourseLink` table (`folderCmid`, `folderName`).
- **Flow:** `publishToLms()` gains Mode C when `TAXILA_UPLOAD_ENABLED=true` **and** the request's
  course has a link with a folder: render the published handout PDF (existing Word → PDF export),
  call `uploadHandoutToFolder({ courseId, folderCmid, filename, pdf })`, write `LmsPublishLog`
  with `mode` = existing `HTTP` value and the Taxila file URL as `externalRef` (no enum change).
- **The upload call is a clearly marked stub** that throws "Taxila upload isn't set up yet"
  until IT names the function. With `TAXILA_UPLOAD_ENABLED=false` (default) Mode C is never
  chosen; **Mode B (export ZIP) stays the working path.**
- **What Moodle needs from IT** (standard Moodle has no web-service function that adds a file
  to an existing Folder activity):
  - a function that does it — e.g. a small local plugin `local_hmp_folder_add_file(cmid,
itemid)` used after `core_files_upload` / `webservice/upload.php` puts the file in the token
    user's draft area — or the name of whatever they already have;
  - token capabilities: `webservice/rest:use`, `moodle/course:view` and `moodle/course:viewparticipants` (reads),
    `moodle/user:viewdetails` (`core_user_get_users`), `mod/folder:managefiles` +
    `moodle/course:manageactivities` on the target courses (upload), `moodle/user:manageownfiles`
    (draft area), and the functions enabled on HMP's external service.

## C. BITS SSO (SAML 2.0, Shibboleth IdP)

**Library** `@node-saml/node-saml` (signature/encryption/time checks), used from our own routes;
NextAuth v5 keeps issuing the normal session.

**Routes**

- `GET /api/auth/saml/login?next=…` — builds the AuthnRequest, **HTTP-Redirect binding**
  (signed in the query string if the metadata says `AuthnRequestsSigned="true"`). Redirect, not
  POST, so our strict CSP (`form-action 'self'`, no inline scripts) is untouched.
- `POST /api/auth/saml/acs` — path taken from our SP metadata. Validates the response, matches
  the user, issues a **one-time sign-in ticket** (random, 60 s, single use, stored in Redis or
  memory) and redirects to `/login/sso?ticket=…`, which signs in through a second NextAuth
  provider (`bits-sso`) whose `authorize()` only accepts a valid unused ticket. Same session,
  roles and permissions as today.
- `GET /api/auth/saml/metadata` — serves SP metadata generated from the same settings, so you
  can diff it against the file IT has.

**Validation** (all must pass): signature by the IdP certificate from its metadata (assertion
signed if `WantAssertionsSigned`); encrypted assertions decrypted with our key; Issuer = IdP
entityID; Audience = our entityID; Destination/Recipient = our ACS URL; `InResponseTo` matches a
request we sent (stored 5 min); `NotBefore`/`NotOnOrAfter` with **2 minutes** skew; assertion ID
**single use** (stored until it expires).

**Who gets in:** match on `mail` (lowercased) → `User.email`; fallback on `uid` only when exactly
one active HMP user's email starts with `<uid>@` (no new column); **never on NameID** (transient).
User must exist **and** be active; roles come from HMP. Otherwise: "Your BITS account isn't set up
in the Handout Portal — contact the Instruction Cell." Every SSO sign-in and refusal is audited.

**Login page:** "Sign in with BITS ID" is the main button. Email + password only when
`PASSWORD_LOGIN_ENABLED=true` (the server action and the credentials provider both refuse
otherwise). **Decision for you:** to avoid locking everyone out, I propose password login also
stays on while SSO isn't configured on that server (no IdP/SP settings) — see §H.

**Keys:** `SAML_SP_PRIVATE_KEY` (PEM in env) or `SAML_SP_PRIVATE_KEY_FILE` (path outside the
repo); certificate from the SP metadata file. Nothing in git; the laptop copy lives in
`local-data/sso/`.

**Rate limiting:** the existing limiter only throttles `/callback/credentials`; ACS gets its own
per-IP limit.

**Tests (no network):** a local fake IdP using a key pair generated in the test — valid
assertion; bad signature; wrong audience; expired; replayed; unknown user; inactive user; plus
encrypted assertion, wrong `InResponseTo`, NameID ignored (mail wins). E2E: the login page shows
the BITS button; CI keeps `PASSWORD_LOGIN_ENABLED=true` so the existing specs still sign in.

## D. Env settings the server will need

| Setting                                             | Value / note                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAXILA_WS_URL`                                     | `https://taxila-aws.bits-pilani.ac.in/webservice/rest/server.php`                                                                               |
| `TAXILA_WS_TOKEN`                                   | the **new HMP-only** token from IT (not the shared one)                                                                                         |
| `TAXILA_UPLOAD_ENABLED`                             | `false` until IT provides the upload function                                                                                                   |
| `SAML_SP_METADATA_FILE`                             | path to our SP metadata XML (outside the repo)                                                                                                  |
| `SAML_SP_PRIVATE_KEY_FILE` or `SAML_SP_PRIVATE_KEY` | the SP private key (outside the repo)                                                                                                           |
| `SAML_IDP_METADATA_URL`                             | `https://idp.bits-pilani.ac.in/idp/profile/Metadata/SAML` (fetched at start and cached; a saved copy can be given via `SAML_IDP_METADATA_FILE`) |
| `PASSWORD_LOGIN_ENABLED`                            | `true` only as an admin fallback                                                                                                                |
| `SHOW_DEMO_LOGINS`, `AI_FEATURES_ENABLED`           | unset / `false` (as before)                                                                                                                     |

## E. Order of work

1. SP metadata check (needs the XML) → report.
2. Moodle module + tests → admin connection page.
3. New tables + migration → Taxila links page (suggest/confirm) → course-row comparison →
   "Open in Taxila".
4. Mode C (folder recording, flow, stub, flag).
5. SSO: settings from metadata → routes → ticket provider → login page → tests.
6. Env docs, ci-local both jobs, push (no merge), draft message to IT.

## F. Open questions for IT (draft message comes at the end)

1. **Upload:** which web-service function puts a file into an existing Folder activity (or will
   they add one)? Needed for Mode C.
2. **A dedicated HMP token**, limited to the functions HMP uses and to the HMP server's IP; and
   retire the token that has been shared.
3. **Course naming:** the shortname/fullname format of Taxila courses (does it always contain the
   BITS course code, e.g. `MBA ZC417`?), and can HMP get `core_course_get_courses_by_field` or
   `core_course_search_courses` to find a course by code directly?
4. **Attributes:** which attributes the IdP will release to HMP (`mail`, `uid`, `cn`,
   `employeeType`?) and the format of `uid`.
5. **Email domain:** which `mail` faculty sign in with — `@wilp.bits-pilani.ac.in` or their campus
   domain (`@pilani…`, `@goa…`, `@hyderabad…`)? HMP's accounts currently use campus domains.
6. **Encryption:** will the IdP encrypt assertions to our certificate? (Supported either way.)

## G. Decisions needed from you

1. **Password login while SSO isn't configured** — recommended: on, so no server can lock
   everyone out; `PASSWORD_LOGIN_ENABLED=true` keeps it on after SSO is live.
2. **`uid` fallback rule** as above (only when exactly one active account matches), or `mail`
   only until IT confirms the `uid` format.
3. **One live, read-only call to Taxila** from the laptop (`core_webservice_get_site_info` — no
   user data) once the token is in `.env`, to list exactly which functions this token can use, so
   the IT message is precise. Tests and CI never call Taxila either way.
