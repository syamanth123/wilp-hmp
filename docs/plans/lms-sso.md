# Plan — Taxila (Moodle) read integration, publish "Mode C", BITS SSO

Branch `feature/lms-sso` (off `feature/handout-editor-ux`). Rules: no merge, no deploy, no real
calls to Taxila or the BITS IdP from tests or CI, no secrets in git. Code starts only after this
plan is approved.

## 0. Inputs — what's here and what isn't

| Input                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAXILA_WS_TOKEN` in `C:\work\wilp-hmp\.env`         | **Not there yet.** Not needed to write the code (tests use saved responses), only for the admin check page on the laptop.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Our SP metadata `local-data/sso/hmp-sp-metadata.xml` | **Generated on the server (2026-11-02), copy not on the laptop yet.** Stated values: entityID `https://hmp.wilp-connect.net/api/saml/metadata`; one ACS, HTTP-POST, `https://hmp.wilp-connect.net/api/saml/acs`; signed AuthnRequests (RSA-SHA256); signed assertions required; encrypted assertions supported; requests `mail` (required), `uid`, `cn`, `employeeType`. Key pair stays on the server: `/home/ubuntu/hmp-saml/sp-key.pem`, `sp-cert.pem`. The check below still needs the XML itself (public — safe to copy). |
| BITS IdP metadata (public)                           | Read on 2026-10-31. EntityID `https://idp.bits-pilani.ac.in/idp/shibboleth`. SSO endpoints for HTTP-Redirect and HTTP-POST. One certificate, `CN=idp.bits-pilani.ac.in`, valid to 14 Jul 2034. Its `KeyDescriptor` has no `use=`, so it is used for signing **and** the IdP may encrypt assertions to us. NameID formats: transient (and the old Shibboleth 1.0 one).                                                                                                                                                         |
| eLearn SP metadata (public, reference)               | HTTP-POST ACS; `AuthnRequestsSigned="true"`, `WantAssertionsSigned="true"`; transient NameID; requests `uid`, `mail`, `cn`, `employeeType`.                                                                                                                                                                                                                                                                                                                                                                                   |

**SP metadata check (runs first, the moment the XML is saved).** HMP's SAML settings will be
read _from that file_, not typed in by hand, so the two can't drift. Before writing any SSO code
I will check and report:

1. `entityID` — an https URL on the live HMP domain (not `localhost`, not an IP, not `http`).
2. `AssertionConsumerService` — exactly one, `Binding` = HTTP-POST, `Location` =
   `https://hmp.wilp-connect.net/api/saml/acs` (moved out of `/api/auth/…`, which NextAuth owns).
   Our routes use whatever path the file says.
3. A signing certificate present and not expired. The private key never leaves the server, so
   "the key matches the certificate" is checked **on the server**: HMP checks it at start-up (SSO
   stays off with a clear log line if they don't match), and the install steps include a one-line
   `openssl` comparison of the two public keys (never prints the private key).
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

All under **`/api/saml/`** (outside NextAuth's `/api/auth/…`, so the two can't clash).

- `GET /api/saml/login?next=…` — builds the AuthnRequest, **HTTP-Redirect binding**, signed
  **RSA-SHA256** in the query string. Redirect, not POST, so our strict CSP (`form-action 'self'`,
  no inline scripts) is untouched. `next` travels as RelayState (only same-site paths accepted).
- `POST /api/saml/acs` — path taken from our SP metadata. Validates the response, matches
  the user, issues a **one-time sign-in ticket** (random, 60 s, single use, stored in Redis or
  memory) and redirects to `/login/sso?ticket=…`, which signs in through a second NextAuth
  provider (`bits-sso`) whose `authorize()` only accepts a valid unused ticket. Same session,
  roles and permissions as today.
- `GET /api/saml/metadata` (= our entityID) — serves **the generated XML file itself**, byte for
  byte (`SAML_SP_METADATA_PATH`), so what the URL shows is exactly what IT registered. At start-up
  HMP reads its entityID, ACS and certificate **from that file** and checks the certificate equals
  `SAML_SP_CERT_PATH` and matches `SAML_SP_KEY_PATH`; any mismatch → SSO off + a clear log line
  (password login unaffected).

**Plumbing that must not block SSO** (checked in the code):

- The middleware already skips every `/api/…` path, so `/api/saml/*` is reachable signed out.
  `/login/sso` is **not** skipped today (only `/login` is public) → add it to the public pages.
- The ACS is a cross-site POST from `idp.bits-pilani.ac.in`, so it gets **no** same-origin check
  (that check lives per upload route, not globally — nothing to switch off). Its protection is the
  signature, `InResponseTo` and the one-time assertion ID.
- The sent request IDs are kept **on the server** (Redis, memory fallback), not in a cookie: our
  `SameSite=Lax` cookies aren't sent on that cross-site POST.

**Validation** (all must pass): signature by the IdP certificate from its metadata (assertion
signed if `WantAssertionsSigned`); encrypted assertions decrypted with our key; Issuer = IdP
entityID; Audience = our entityID; Destination/Recipient = our ACS URL; `InResponseTo` matches a
request we sent (stored 5 min); `NotBefore`/`NotOnOrAfter` with **2 minutes** skew; assertion ID
**single use** (stored until it expires).

**Who gets in** (decided 2026-11-02: `mail` first, `uid` fallback): match on `mail` (lowercased)
→ `User.email`; fallback on `uid` only when exactly one active HMP user's email starts with
`<uid>@` (no new column); **never on NameID** (transient).
**My recommendation on _when_ the fallback applies:** only when the IdP sends **no** `mail`. If
`mail` is sent but matches no account, refuse rather than fall back. Otherwise a person whose
`mail` HMP doesn't know (e.g. `amit@goa…`) could be signed in to a _different_ person's account
that happens to start with the same uid (`amit@pilani…`). The IC fixes such cases by correcting
the email in HMP. Since `mail` is marked required in our metadata, the fallback should rarely run.
User must exist **and** be active; roles come from HMP. Otherwise: "Your BITS account isn't set up
in the Handout Portal — contact the Instruction Cell." Every SSO sign-in and refusal is audited.

**Login page:** "Sign in with BITS ID" is the main button. Email + password only when
`PASSWORD_LOGIN_ENABLED=true` (the server action and the credentials provider both refuse
otherwise). **Decision for you:** to avoid locking everyone out, I propose password login also
stays on while SSO isn't configured on that server (no IdP/SP settings) — see §G.

**Keys:** read from files on the server — `SAML_SP_KEY_PATH=/home/ubuntu/hmp-saml/sp-key.pem`,
`SAML_SP_CERT_PATH=/home/ubuntu/hmp-saml/sp-cert.pem`. The same key signs AuthnRequests and
decrypts encrypted assertions. **HMP never generates a key pair** (a new key would silently break
SSO until IT re-uploads the metadata). Nothing in git; tests make a throwaway pair in memory.
`~/hmp-saml` is outside the code folder, so installs and rollbacks never touch it; a rebuilt
server needs that folder copied across first.

**Rate limiting:** the existing limiter only throttles `/callback/credentials`; ACS gets its own
per-IP limit.

**Tests (no network):** a local fake IdP using a key pair generated in the test — valid
assertion; bad signature; wrong audience; expired; replayed; unknown user; inactive user; plus
encrypted assertion, wrong `InResponseTo`, NameID ignored (mail wins), no `mail` → `uid` fallback
(one match signs in, two matches refused), `mail` sent but unknown → refused. Settings: the login
redirect carries `SigAlg=…rsa-sha256` and a signature our certificate verifies; `/api/saml/metadata`
returns the file's exact bytes; certificate ≠ metadata's, or key ≠ certificate → SSO off, password
login still works. E2E: the login page shows the BITS button, `/login/sso` and `/api/saml/metadata`
open signed out; CI keeps `PASSWORD_LOGIN_ENABLED=true` so the existing specs still sign in.

## D. Env settings the server will need

| Setting                                   | Value / note                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAXILA_WS_URL`                           | `https://taxila-aws.bits-pilani.ac.in/webservice/rest/server.php`                                                                               |
| `TAXILA_WS_TOKEN`                         | the **new HMP-only** token from IT (not the shared one)                                                                                         |
| `TAXILA_UPLOAD_ENABLED`                   | `false` until IT provides the upload function                                                                                                   |
| `SAML_SP_METADATA_PATH`                   | the generated SP metadata XML on the server, e.g. `/home/ubuntu/hmp-saml/<file name>` — **which name did the generator use?**                   |
| `SAML_SP_KEY_PATH`                        | `/home/ubuntu/hmp-saml/sp-key.pem` (private key; never in git, chat or email)                                                                   |
| `SAML_SP_CERT_PATH`                       | `/home/ubuntu/hmp-saml/sp-cert.pem`                                                                                                             |
| `SAML_IDP_METADATA_URL`                   | `https://idp.bits-pilani.ac.in/idp/profile/Metadata/SAML` (fetched at start and cached; a saved copy can be given via `SAML_IDP_METADATA_FILE`) |
| `PASSWORD_LOGIN_ENABLED`                  | `true` only as an admin fallback                                                                                                                |
| `SHOW_DEMO_LOGINS`, `AI_FEATURES_ENABLED` | unset / `false` (as before)                                                                                                                     |

## E. Order of work

1. SP metadata check (needs a copy of the XML in `local-data/sso/hmp-sp-metadata.xml`) → report.
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
2. ~~`uid` fallback~~ — **decided 2026-11-02:** `mail` first, `uid` fallback (exactly one active
   match). Still open: fall back **only when `mail` is missing** (recommended, see "Who gets in"),
   or also when `mail` is sent but unknown.
3. **One live, read-only call to Taxila** from the laptop (`core_webservice_get_site_info` — no
   user data) once the token is in `.env`, to list exactly which functions this token can use, so
   the IT message is precise. Tests and CI never call Taxila either way.

**Decided 2 Nov 2026:** (1) password login stays **on** (`PASSWORD_LOGIN_ENABLED=true`) until SSO
is tested on the live site; after that it is for administrators only. (2) `uid` fallback **only
when `mail` is absent**; `mail` sent but unknown → refused ("account isn't set up"), audited with
the email only. (3) Taxila: one read-only `core_webservice_get_site_info` call once the token is
in `.env` (still waiting for the token).

## H. As built — part C (BITS SSO)

**SP metadata checked 2 Nov 2026** (`local-data/sso/hmp-sp-metadata.xml`, generated on the server
by `make-hmp-sp-metadata.sh`): entityID `https://hmp.wilp-connect.net/api/saml/metadata`; one
HTTP-POST ACS `…/api/saml/acs`; `AuthnRequestsSigned` and `WantAssertionsSigned` true; one RSA
3072 certificate (`CN=hmp.wilp-connect.net`, valid to 30 Oct 2036, SHA-256
`78:07:56:…:13:92`) used for both signing and encryption; encryption methods start with
`rsa-oaep-mgf1p` (the `xmlenc11#rsa-oaep` line was removed — node-saml's `xml-encryption` 3.1.0
can't decrypt it); `uid` + `mail` required, `cn` + `employeeType` optional; no private key in the
file. **Ready to send to IT.** A copy is the test fixture
`apps/web/src/lib/saml/__tests__/__fixtures__/hmp-sp-metadata.xml` (public).

**Changes from the plan above, and why:**

- **No ticket hop / no `/login/sso` page.** The ACS route signs the user in itself: it calls
  `signIn('bits-sso', { proof })` in the same request (Auth.js runs in-process, CSRF skipped,
  cookies set on the 303 response). The proof is an HMAC (Web Crypto, 30 s, keyed from the
  Auth.js secret with a purpose label) that never reaches the browser — so nothing Redis-backed
  is needed inside `@hmp/auth`, which the Edge middleware imports.
- **Request IDs and assertion IDs in process memory** (node-saml `InMemoryCacheProvider`,
  consumed on use, `rejectReplayedAssertions`), not Redis: HMP runs as one `next start` process.
  Switch to a shared store if it ever runs as several.
- **IdP metadata from a file** (`SAML_IDP_METADATA_PATH`), downloaded once at install, not
  fetched at run time.
- **Password policy** (`packages/auth/src/password-policy.ts`): everyone may use a password while
  `PASSWORD_LOGIN_ENABLED=true` **or** SSO isn't set up on the server; otherwise administrators
  only (the form folds away under "Administrator sign-in"). Nobody can be locked out entirely.

**Code:** `apps/web/src/lib/saml/` (metadata, config, sp, attributes, match-user, relay,
messages, app-url, prisma-finder), routes `apps/web/src/app/api/saml/{login,acs,metadata}`,
`packages/auth/src/{sso-proof,password-policy}.ts`, the `bits-sso` provider in
`packages/auth/src/config.ts`, the login page button and messages.

**Tests (no network):** a fake IdP (`__tests__/fake-idp.ts`, throwaway keys) — signed and
encrypted assertions accepted; tampered, foreign-signed, unsigned, wrong-audience, expired,
unsolicited and replayed responses rejected; the redirect is signed RSA-SHA256 and verifies with
our certificate; config refuses a missing setting, unreadable file, cert ≠ metadata, key ≠ cert,
other ACS path, http entityID, other site than `NEXTAUTH_URL`, expired cert; account matching
(mail, uid-only-when-no-mail, ambiguous, inactive, NameID ignored); ACS route end to end with the
database mocked; metadata route returns the file's exact bytes; proof and password policy units.

**Server settings for the SSO release** (add to `apps/web/.env.production`, then restart):

```
SAML_SP_METADATA_PATH='/home/ubuntu/hmp-saml/hmp-sp-metadata.xml'
SAML_SP_KEY_PATH='/home/ubuntu/hmp-saml/sp-key.pem'
SAML_SP_CERT_PATH='/home/ubuntu/hmp-saml/sp-cert.pem'
SAML_IDP_METADATA_PATH='/home/ubuntu/hmp-saml/bits-idp-metadata.xml'
PASSWORD_LOGIN_ENABLED='true'
```

IdP metadata, once: `curl -fsS -o ~/hmp-saml/bits-idp-metadata.xml
https://idp.bits-pilani.ac.in/idp/profile/Metadata/SAML` — the published metadata address; the entityID URL `/idp/shibboleth` is a name, not where the file is served (check it names `entityID="https://idp.bits-pilani.ac.in/idp/shibboleth"`).
If any file is missing or disagrees, the log says `[saml] BITS sign-in is OFF: <reason>` and
the login page simply shows no BITS button.
