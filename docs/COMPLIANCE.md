# Privacy & compliance posture (draft — requires legal review before selling to US schools)

## Principles
- **Local-first**: the app is fully functional with zero account. Accounts add sync + classroom only.
- **Pseudonymous students**: class-code join, display name only. No student email, no DOB collection.
- **No third-party trackers** for student sessions. Product analytics (if any) are first-party, anonymized, aggregate.

## COPPA (under-13, US)
- We avoid collecting personal information from children: no email, no real-name requirement, no photos, no free-text chat.
- Teacher/school acts as the intermediary (school-official consent model) for Classroom accounts.
- Data deletion: teacher can remove a student; removal cascades (see `on delete cascade` in schema.sql). A self-serve deletion endpoint must exist before launch.

## FERPA
- Progress data (lesson stars) is an education record. Access limited by RLS to the student and their class's teacher.
- Export: teacher CSV export only for their own classes.
- No sale of data, no advertising use — put this in the ToS verbatim.

## App Store privacy nutrition labels (Phase 6D)
- Data collected: none (logged-out) / account identifier + progress (logged-in, optional).
- No tracking, no third-party advertising SDKs.

## Action items before revenue from schools
- [ ] Real privacy policy + ToS pages (lawyer-reviewed)
- [ ] Signed DPA template for districts
- [ ] Data deletion self-serve endpoint + documented retention policy
- [ ] Verify Supabase data-residency options if selling into EU (GDPR) — likely US-East fine for US launch
