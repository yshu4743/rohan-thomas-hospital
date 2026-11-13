# Hospital + Pharmacy page

One file, no build step, no dependencies. Open `index.html` in a browser and it works.

## 1. Put your details in (2 minutes)

Open `index.html`, scroll to the bottom, and edit the `SITE` block:

```js
const SITE = {
  name:      "Leo Hospital",
  tagline:   "Hospital & Pharmacy",
  phone:     "917994804743",
  phoneText: "+91 79948 04743",
  address:   "Your street, town, PIN",
  mapsQuery: "Leo Hospital, Angamaly, Kerala",
  govtAided: false,
  govtLabel: "Government Aided"
};
```

That one block updates the header, call buttons, WhatsApp links, footer, and address.

**`govtAided` stays `false` until you physically hold the certificate.** Flipping it is one word, and it is the only difference between "a hospital" and "a false claim". Get the paper first.

## 2. Get it online (free, 5 minutes)

Pick one:

| Option | How |
|---|---|
| **Netlify Drop** | netlify.com/drop → drag this folder in → live URL instantly |
| **Cloudflare Pages** | pages.cloudflare.com → direct upload |
| **GitHub Pages** | new repo → upload `index.html` → Settings → Pages |

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

## 5. Safety / legal note

Editing another company's website through its internal APIs is unauthorised
access under the IT Act (s.43/66), even if you own the domain name. If
`leogroup.in` is run by a vendor, the route is their partner-onboarding form
plus a written email — not their endpoints. Fixing this page and your Google
profile is legal, permanent, and cannot be taken away from you.
