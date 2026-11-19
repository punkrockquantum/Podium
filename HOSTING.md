# Hosting Podium in the cloud

Podium normally runs on a laptop in the room, and can be shared for testing through a temporary
tunnel (README, section 9). This page is the third way: **Podium on a cloud host, at one address
that never changes and does not need the laptop.**

You do not need to be a developer to follow it. The one-time setup is about ten minutes of clicking
in a web dashboard.

## Contents

1. [What you get](#1-what-you-get)
2. [Choose a plan](#2-choose-a-plan)
3. [One-time setup on Render](#3-one-time-setup-on-render)
4. [The address and the four screens](#4-the-address-and-the-four-screens)
5. [The three PIN variables](#5-the-three-pin-variables)
6. [Getting a new version](#6-getting-a-new-version)
7. [What is kept, and how to reset the game](#7-what-is-kept-and-how-to-reset-the-game)
8. [Checking it and fixing it](#8-checking-it-and-fixing-it)
9. [Other hosts: Fly.io or any Docker host](#9-other-hosts-flyio-or-any-docker-host)
10. [The laptop and the tunnel still work](#10-the-laptop-and-the-tunnel-still-work)
11. [Settings reference](#11-settings-reference)
12. [Why it is built this way](#12-why-it-is-built-this-way)

---

## 1. What you get

- **One address** such as `https://podium.onrender.com`. It is the same after every restart and every
  update, so a link sent to a colleague keeps working.
- **No laptop.** The game runs on the host's computer, not yours. Closing the lid changes nothing.
- **The same game.** The landing page, the four table pages, the host controls and the projector are
  exactly the ones in the README. HTTPS is provided by the host.

Two things to know before you start:

- **Podium needs a host that runs a program all the time.** It cannot go on a static host (GitHub
  Pages, Netlify, Vercel or Cloudflare Pages in their plain file-serving form): those only hand out
  files, and Podium is a small server that keeps the live game and answers every iPad once a second.
- **It must run as exactly one instance.** The whole game lives in the memory of one running
  program. Two copies would be two different games. The files in this repo ask for one; never turn on
  scaling.

## 2. Choose a plan

| Option | The game after a restart | Cost | Good for |
| --- | --- | --- | --- |
| **A. Render, free plan** (what `render.yaml` asks for) | Starts empty. A free service is also stopped when nobody has used it for a while, and takes about a minute to wake. | Free. | Colleagues trying the game; rehearsals. |
| **B. Render, paid plan with a disk** | Kept. The game is saved on the disk. Never sleeps. | Paid monthly: check the provider's current pricing. | A real event. |
| **C. Fly.io** (`fly.toml`) | Kept, on a volume. Never sleeps. | Paid by use: check the provider's current pricing. | A real event, if you prefer Fly and are happy to type commands. |

**Recommendation:** start with **A** today, because it costs nothing and gives the stable address at
once. Move to **B** before an event that matters (it is two small changes, in
[section 7](#7-what-is-kept-and-how-to-reset-the-game)); the address stays the same.

About option A, from Render's own description of free services
([render.com/docs/free](https://render.com/docs/free), read when this page was written; check it
again): a free web service is stopped after 15 minutes with no visitors, wakes on the next visit in
about a minute, may be restarted by Render at any time, and has no disk. While any Podium page is
open in a browser it asks the server for news every second, which counts as a visit, so an open
screen keeps the game awake.

## 3. One-time setup on Render

You need: a browser, the GitHub login that owns the Podium repo, and three PINs you have chosen
([section 5](#5-the-three-pin-variables)).

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign up or sign in. **Sign in with
   GitHub** is the quickest, because Render then already knows who you are on GitHub.
2. Click **New**, then **Blueprint**.
3. If Render asks to connect GitHub, click **Connect GitHub** (or **Configure account**) and allow it
   to see the **Podium** repository (`punkrockquantum/Podium`). Choosing "Only select repositories"
   and ticking Podium is enough.
4. Pick the **Podium** repository from the list.
5. Give the Blueprint a name (for example `podium`). For **Branch**, choose the branch that contains
   the file `render.yaml`: `main` once this work has been merged, `cloud-host` before that.
6. Render reads `render.yaml` and shows one web service called **podium** on the **Free** plan in
   **Frankfurt**. It then asks for three values. Type your own PINs:
   - `HOST_PIN`: the host PIN.
   - `LEADER_PIN`: the PIN for the Solutions Architects.
   - `RACE_PIN`: the race password asked for on the projector.
7. Click **Deploy Blueprint** (the button may read **Apply**). The first build takes a few minutes.
8. Click the **podium** service. When the latest entry under **Events** says **Deploy live**, the
   address is shown near the top of the page under the service's name, ending in `.onrender.com`.
   Open it: you should see the Podium landing page.
9. Check the PINs took effect: open `/host.html` on that address and sign in with your host PIN.

That is all. Nothing needs to be installed on your computer, and no password or PIN is stored in the
repository.

## 4. The address and the four screens

Render builds the address from the service's name: `https://podium.onrender.com`, or with a few
extra letters after `podium` if that name is taken. It does not change when the service restarts,
sleeps, wakes or is updated. It only changes if you delete the service and create a new one.

| Screen | Address |
| --- | --- |
| Landing page (the four tables) | `https://<your-address>/` |
| A table iPad | `https://<your-address>/station.html?station=network` (or `oem`, `dc`, `compute`) |
| Host controls | `https://<your-address>/host.html` |
| Projector | `https://<your-address>/race.html` |

A name of your own (for example `podium.yourcompany.com`) can be added later in the service's
**Settings**, under **Custom Domains**.

## 5. The three PIN variables

**Set all three, to values only your team knows.** The Podium repository is public and contains the
default PIN, so a hosted game left on the default can be controlled by anyone who reads the code.
If a variable is missing or empty, the default applies to it.

| Variable | Used for |
| --- | --- |
| `HOST_PIN` | The session host: everything in the host controls. |
| `LEADER_PIN` | The Solutions Architects (one shared PIN; each SA picks their table). |
| `RACE_PIN` | The race password asked for on the projector. |

- Use 1 to 64 letters, digits, `_` or `-`. The three may be the same value: then there is one PIN to
  remember, as on the laptop.
- **Where they live on Render:** the **podium** service, **Environment** in the left menu. To change
  one, edit its value and click **Save, rebuild, and deploy** (or **Save and deploy**). The game
  restarts, so do it between sessions.
- Tell people the PIN in person. It is never shown on a screen, in an address or in a log.
- Ten wrong PINs from one visitor in five minutes lock that visitor out for five minutes.

## 6. Getting a new version

Updates are **not** automatic, on purpose: a change pushed to GitHub in the middle of a session must
not restart the game.

1. Open the **podium** service in the Render dashboard.
2. Click **Manual Deploy**, then **Deploy latest commit**.
3. Wait for **Deploy live** (a few minutes).

On the free plan the update starts a fresh, empty game. With a disk (option B) the game carries on
where it was. Either way, **do not update during a session**: the screens show "Reconnecting to the
game server" while it restarts.

To go back to the version before, open **Deploys** (or **Events**), find the earlier deploy and
choose **Rollback**.

## 7. What is kept, and how to reset the game

**To empty the game on purpose:** open the host controls (`/host.html`), sign in with the host PIN
and use **Restart the experience**. This works the same on every host and is the right thing to do
before the doors open and after testing.

**What survives a restart of the service:**

| | Free plan (A) | Paid plan with a disk (B), Fly.io (C) |
| --- | --- | --- |
| The address | Kept | Kept |
| The three PINs | Kept | Kept |
| Teams, choices, approvals, the race | **Lost: a fresh game** | Kept (saved after every change) |

On the free plan a restart happens on every update, whenever you change a PIN, when Render restarts
the service, and after the service has slept. So: do not update during a session, and keep one
Podium page open from the first team's arrival to the readouts.

**Moving from A to B (keeping the game across restarts):**

1. In `render.yaml`, change `plan: free` to the smallest paid plan (`plan: 0.5c-512mb`; older Render
   pages call it Starter) and remove the `#` from the four `disk` lines at the bottom. Commit and
   push. (Ask whoever looks after the repo, or do the same in the dashboard: **Settings**, **Instance
   Type**, then **Disks**, **Add Disk**, mount path `/data`, size 1 GB.)
2. Render asks you to confirm the paid plan and adds the disk. The address and the PINs stay.

The game is then saved in the file `/data/state.json` on the disk. A disk belongs to one instance,
which is what Podium needs anyway.

**Cost.** These notes carry no prices because they change. What is known from the sibling project
TokenQuest's hosting notes: on Render "persistent disks need a paid instance type (Starter or
above); the free tier has no disk", and on Fly.io the setup is one small shared machine with a 1 GB
volume. For amounts, check the provider's current pricing:
[render.com/pricing](https://render.com/pricing), [fly.io/pricing](https://fly.io/pricing).

## 8. Checking it and fixing it

Open `https://<your-address>/api/health`. A healthy game answers with one line starting
`{"ok":true,"app":"podium"` and says how many teams there are. Render asks the same question every
few seconds and restarts the service if it stops answering.

| Symptom | What to do |
| --- | --- |
| A Render page saying the service is waking up | The free service was asleep. Wait about a minute; the game is new and empty. |
| The game is suddenly empty | The service restarted or slept (free plan). Use option B for events. |
| "Wrong PIN" with a PIN you are sure of | Check the three values under **Environment**. A missing value means the default applies. |
| "Too many failed PIN attempts" | Ten wrong PINs from one visitor. Wait five minutes. |
| The build fails | Open the failed entry under **Events** and read the last lines. Check the Blueprint's branch contains `Dockerfile` and `render.yaml`. |
| You want it gone | **Settings**, bottom of the page: **Suspend Web Service** (keeps the address for later) or **Delete Web Service**. |

The service's **Logs** page shows Podium's start-up lines, including which PIN variables came from
the environment (never their values) and the line
`Failed PINs are counted per visitor address: the cf-connecting-ip header (TRUST_PROXY=render)`.

## 9. Other hosts: Fly.io or any Docker host

These need a terminal, so they are for whoever looks after the repo.

**Fly.io** (`fly.toml`: one small machine in London with a 1 GB volume at `/data`; the game is kept
across restarts). Install the `fly` command and sign in first
([fly.io/docs](https://fly.io/docs/flyctl/install/)).

```sh
fly launch --no-deploy --copy-config --name <unique-app-name>   # then set app = "<unique-app-name>" in fly.toml
fly secrets set HOST_PIN=<the host PIN> LEADER_PIN=<the SA PIN> RACE_PIN=<the race password>
fly deploy --ha=false                                            # one machine: a volume belongs to one machine
```

The address is `https://<unique-app-name>.fly.dev`. Update with `fly deploy --ha=false`. Never run
`fly scale count` above 1.

**Any Docker host, or a test on your own machine** (needs Docker):

```sh
docker build -t podium .
docker run --rm -p 8080:8080 -e HOST_PIN -e LEADER_PIN -e RACE_PIN -v podium-data:/data podium
```

`-e HOST_PIN` passes the value from your shell without writing it anywhere; the game is kept in the
`podium-data` volume. The image listens on plain HTTP: put it behind something that provides HTTPS
before sharing it, and set `TRUST_PROXY` to match that proxy ([section 11](#11-settings-reference)).

## 10. The laptop and the tunnel still work

Nothing about the laptop changes. `start.command`, `npm start`, `npm run start:lan`, the background
service and the Quick Tunnel in the README (sections 8 and 9) behave as before, and none of the
settings on this page need to be set there.

| | Laptop in the room | Laptop + Quick Tunnel | Cloud host (this page) |
| --- | --- | --- | --- |
| Address | `http://<laptop>:8080/` on the room Wi-Fi | A new `trycloudflare.com` address every time the tunnel restarts | One fixed address |
| Needs the laptop awake | Yes | Yes | No |
| Needs the internet | No | Yes | Yes |
| Where the game is saved | `data/state.json` on the laptop | The same | On the host (kept only with a disk) |
| Best for | The event itself in a room with poor internet | A quick look by one remote colleague | Colleagues testing, remote sessions, events with good internet |

The cloud game and the laptop game are **separate games**: teams added on one do not appear on the
other. Pick one for a session and give everyone that address.

## 11. Settings reference

All are environment variables. On Render they are under **Environment**; `render.yaml`, `fly.toml`
and the `Dockerfile` already set the ones marked "set for you".

| Variable | Meaning | On a cloud host |
| --- | --- | --- |
| `HOST_PIN`, `LEADER_PIN`, `RACE_PIN` | The three PINs ([section 5](#5-the-three-pin-variables)). | **You set these**, as secrets. |
| `PORT` | The port to listen on (8080 if unset). | Set for you by the host. |
| `HOST` | The address to listen on. Must be an IP address; `0.0.0.0` means every interface. Unset: this machine only, or every interface with `--lan`. | Set for you (`0.0.0.0` in the `Dockerfile`). |
| `DATA_DIR` | The folder for the saved game (`state.json`). | Set for you (`/data`). |
| `TRUST_PROXY` | Whose word to take for a visitor's address when counting wrong PINs: `render` or `cloudflare` (the `CF-Connecting-IP` header), `fly` (`Fly-Client-IP`), `xff` (the last entry of `X-Forwarded-For`, for a proxy of your own that adds it), or `none` (the connecting address). | Set for you (`render`, `fly`; `none` in the bare image). |

Why `TRUST_PROXY` exists: behind a host's front door every request reaches Podium from the host's
own machines, so the visitor's real address arrives in a header. Anyone can type such a header, so
Podium believes one only when this setting names the front door that writes it, and a misspelt
value counts as `none`. When it is not set at all (the laptop), Podium uses the connecting address,
and believes `CF-Connecting-IP` only on connections from the laptop itself, which is how the Quick
Tunnel arrives. If the header is ever missing, all visitors share one count: the game still works,
but ten wrong PINs from anyone lock every visitor out of the PIN screens for five minutes.

Podium also sends `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` with every
response, never lets a browser or proxy store an API answer (`Cache-Control: no-store`), and does
not allow other websites to call it (no CORS headers).

## 12. Why it is built this way

Podium's sibling project, TokenQuest, was hosted in the cloud as a Cloudflare Worker with a
Cloudflare database, deployed from the laptop with Cloudflare's command-line tool. That fits a game
where each player plays alone and only finished scores are stored. Its notes also describe a
"server" path for a shared, PIN-protected game: a `Dockerfile` plus `render.yaml` and `fly.toml`, on
"Render, Fly.io, any Docker host".

Podium is a shared live game held in one program's memory, so it follows that server path, file for
file: the same kind of image (official Node on Alpine, no install step, an unprivileged user, a
health check on `/api/health`), a Render Blueprint with the PINs asked for in the dashboard and
auto-deploy off, and a Fly.io file with one machine and a volume.

Running Podium as a Cloudflare Worker like TokenQuest's live site would mean rewriting the server
around Cloudflare's storage (a Durable Object holding the game). That is a larger piece of work and
has not been started; the container above needs no change to the game.

Things to keep in mind on any public address:

- Anyone who has the address can add a team and play. Share it with the people testing or playing,
  and use **Restart the experience** afterwards.
- Everything a team must not do is behind the host PIN, checked by the server on every request.
- Use the `https://` address only. Render and Fly.io provide it.
