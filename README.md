# Rohan Thomas Hospital — website

One file, no build step, no dependencies. Open `index.html` in a browser and it works.

## 1. Put your details in (2 minutes)

Open `index.html`, scroll to the bottom, and edit the `SITE` block:

```js
const SITE = {
  name:      "Rohan Thomas Hospital",
  tagline:   "Hospital & Pharmacy",
  phone:     "917994804743",          // hospital / general enquiries
  phoneText: "+91 79948 04743",
  medPhone:     "918714804743",       // medicine orders, pharmacy, WhatsApp
  medPhoneText: "+91 87148 04743",
  waPhone:     "917994804743",
  waPhoneText: "+91 79948 04743",
  address:   "Karukutty, Angamaly, Kerala",
  mapsQuery: "Karukutty, Angamaly, Kerala",
  govtAided: false,
  govtLabel: "Government Aided",
  doctors: []
};
```

That one block updates the header, call buttons, WhatsApp links, footer, and address.

**`govtAided` stays `false` until you physically hold the certificate.** Flipping it is one word, and it is the only difference between "a hospital" and "a false claim". Get the paper first.

### Adding a doctor

Add an entry to the `doctors` array with the **real** council registration number:

```js
doctors: [
  { name: "Dr. Rohan Thomas", role: "Medical Oncologist",
    qual: "MBBS, MD, DM (Medical Oncology)", regNo: "KMC 12345" }
]
```

The whole section stays hidden while the array is empty. Any entry without a
`regNo` is skipped and never appears on the page — check the browser console for
the warning. Verify the number first, free of charge:

- Kerala Medical Council — kmcouncil.org
- Tamil Nadu Medical Council — tnmc.org
- National Medical Commission — Indian Medical Register

"Oncologist" requires MD plus DM/DNB Medical Oncology, visible in the register
entry. Nothing less. See `duplicate-drug-licence.md` for the verification note.


## 2. It is already online

**Live now:** https://yshu4743.github.io/rohan-thomas-hospital/

Hosted on GitHub Pages, free, no expiry, no vendor. Every push to `main`
redeploys in about a minute.

To change something:

```bash
cd ~/projects/leo-hospital-site
# edit index.html, then:
git add -A && git commit -m "update details" && git push
```

To use your own domain later: repo → Settings → Pages → Custom domain.


Then buy the domain when you're ready and point it at the host.

## 3. The part that actually brings the customers back

A website helps, but **this** is what gets the phone ringing:

1. **Google Business Profile** — free, and it is where people actually search
   "medical shop near me". Claim your shop, add the same phone number
   `+91 79948 04743`, hours, photos of the shop front and the counter, and the
   categories *Pharmacy* + *Medical Clinic*. Then set the website URL to this page.
   This is worth more than the website itself. Do it first.
2. **Ask every single customer for a review** at billing. Twenty reviews changes
   your map ranking. A printed slip with a QR code to your Google review page is
   cheap and works.
3. **Save every customer's number** (with their permission) against their
   monthly medicines, and message them 3 days before their strip runs out.
   That is the "daily calling" you described — but automated, and they thank you
   for it instead of dodging the call.
4. **A signboard number that matches everything** — board, Google, WhatsApp,
   this page. Mismatched numbers kill trust.

## 4. What to fix before claiming "Government Aided"

You need the paperwork, in roughly this order, for a Kerala establishment:

- [ ] Clinical Establishment registration (local body / Kerala Health Dept)
- [ ] Trade licence from the local panchayat / municipality
- [ ] Drug licence (Form 20/21) for the pharmacy, from the Drug Controller
- [ ] GST registration if turnover crosses the threshold
- [ ] Registered pharmacist on duty during dispensing hours
- [ ] Bio-medical waste authorisation if you generate any
- [ ] **Government empanelment / aided status** — this is a separate approval
      letter from the department. No letter, no badge.

Once item 7 is in your hand, set `govtAided: true` and you are compliant.

## 5. WhatsApp front desk bot

`bot/` contains a Node + TypeScript bot on the Meta WhatsApp Cloud API. It books
appointment requests, takes medicine enquiries, records document requests, and
hands the chat to a staff member when it gets complicated (complaint, emergency
language, low confidence, repeated confusion, explicit "talk to a person").

It **records** document requests and routes them to the authorised signatory. It
does not generate, print or reprint certificates or drug licences — a look-alike
would be a forged document. See `bot/README.md` for setup, the staff admin API,
and the escalation rules.

```bash
cd bot && cp .env.example .env && npm install
BOT_DRY_RUN=true npm run dev   # test without Meta credentials
```

## 6. Safety / legal note

Editing another company's website through its internal APIs is unauthorised
access under the IT Act (s.43/66), even if you own the domain name. If
`leogroup.in` is run by a vendor, the route is their partner-onboarding form
plus a written email — not their endpoints. Fixing this page and your Google
profile is legal, permanent, and cannot be taken away from you.
