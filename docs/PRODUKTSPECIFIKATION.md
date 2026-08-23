# Komplet produktspecifikation for ChainGuard

> Status: produktspecifikation (kilde: produktejer, august 2026).
> Dokumentet er styrende for prioritering og arkitektur. Ændringer sker via pull request.

## Den vigtigste konklusion først

Vi kan skabe én samlet onboarding, hvor virksomheden godkender ChainGuards kontrolmandat med
MitID Erhverv. Men **én MitID-godkendelse giver ikke automatisk teknisk adgang** til
Skattestyrelsen, banker, lønsystemer, forsikringer og medarbejderdata.

Den rigtige løsning er:

1. Virksomheden underskriver ét samlet kontrolmandat med MitID Erhverv.
2. ChainGuard guider derefter virksomheden gennem de nødvendige datatilslutninger.
3. Hver datakilde godkendes dér, hvor lovgivningen kræver det.
4. ChainGuard gemmer primært kontrolresultater og dokumentation — ikke flere personoplysninger
   end nødvendigt.

NemID er erstattet af MitID. Produktet skal derfor bygges omkring **MitID Erhverv**.

---

## 1. ChainGuards kerneformål

ChainGuard skal besvare ét spørgsmål:

> Er denne virksomhed og dens medarbejdere dokumenteret compliant til at udføre den konkrete opgave?

Systemet skal kontrollere:

- Virksomhedens identitet og status
- Skat, moms og arbejdsgiverregistrering
- Bankkonto og betalingsmønstre
- Ansatte og lønindberetning
- Lønsedler, timer og udbetalt løn
- Overenskomst eller dokumenterede løn- og arbejdsvilkår
- RUT-registrering
- Forsikringer
- Dokumenternes gyldighed
- Ændringer efter den første godkendelse

ChainGuard skal ikke bare indsamle PDF-filer. Det skal **sammenholde oplysninger fra forskellige
kilder og finde uoverensstemmelser**.

---

## 2. De tre brugerroller

Hold antallet af roller lavt.

### Hovedvirksomheden

- Invitere leverandører
- Se compliance-status
- Se afvigelser og dokumentation
- Godkende eller afvise virksomheder
- Se hele leverandørkæden
- Eksportere en kontrolrapport

### Leverandøren

- Underskrive kontrolmandat
- Forbinde datakilder
- Uploade manglende dokumentation
- Se egne afvigelser
- Rette fejl
- Invitere egne underleverandører

### ChainGuard-kontrollør

- Behandle undtagelser
- Anmode om dokumentation
- Godkende manuelle kontroller
- Ændre kontrolregler
- Se revisionsloggen

En almindelig kunde hos hovedvirksomheden må **kun se det nødvendige kontrolresultat** — ikke
medarbejdernes fulde CPR-numre, bankoplysninger eller komplette lønsedler.

---

## 3. Den letteste onboarding

### Trin 1: Invitation

Hovedvirksomheden indtaster:

- CVR-nummer eller udenlandsk virksomhedsnummer
- Kontaktperson
- E-mail
- Projekt
- Arbejdssted
- Start- og slutdato
- Entreprisesum eller risikoniveau
- Om leverandøren anvender underleverandører
- Om der er udenlandske medarbejdere

ChainGuard henter automatisk offentlige virksomhedsoplysninger.

### Trin 2: Virksomheden identificeres

Leverandøren logger ind og vælger den virksomhed, personen repræsenterer.

ChainGuard kontrollerer:

- At CVR-nummeret eksisterer
- At virksomheden er aktiv
- Tegningsberettigede
- Branchekode
- Adresse
- Registrering for moms og arbejdsgiverforhold
- Reelle ejere
- Konkurs, rekonstruktion eller ophør
- Relation mellem bruger og virksomhed

**Kun en tegningsberettiget eller korrekt bemyndiget person må underskrive kontrolmandatet.**

### Trin 3: Ét samlet kontrolmandat

Virksomheden ser én kort godkendelsesside:

> Jeg giver ChainGuard mandat til at indsamle, kontrollere og løbende overvåge de angivne
> virksomheds-, skatte-, bank-, løn-, medarbejder-, forsikrings- og RUT-oplysninger i den
> angivne periode.

Før underskrift vises tydeligt:

- Hvilke oplysninger der kontrolleres
- Hvem der modtager resultatet
- Hvad kunden kan se
- Hvor længe mandatet gælder
- Hvordan mandatet tilbagekaldes
- Hvor længe oplysninger gemmes
- Hvilke eksterne datakilder der anvendes
- Om kontrollen fortsætter efter projektets afslutning

Underskriften gennemføres med MitID Erhverv.

MitID kan dokumentere identitet og virksomhedshandling, men giver ikke i sig selv adgang til alle
myndigheds- og bankdata. MitID Erhverv bygger desuden på konkrete roller og rettigheder.

### Trin 4: Datatilslutninger

Efter underskriften vises kun de nødvendige tilslutninger:

1. Skat
2. Bank
3. Lønsystem
4. Forsikring
5. RUT, hvis relevant
6. Overenskomst eller arbejdsvilkår

Hver tilslutning vises som: **Forbundet · Kræver handling · Ikke relevant · Udløbet · Fejl**.

Brugeren skal ikke kunne springe relevante punkter over uden at angive en årsag.

---

## 4. Skatte- og virksomhedsoplysninger

### ChainGuard skal kontrollere

- Aktiv virksomhed
- Momsregistrering
- Arbejdsgiverregistrering
- Registrering for A-skat og AM-bidrag
- Indberetningsmønster for løn
- Antal lønmodtagere
- Om indberetninger matcher de fremlagte løndata
- Manglende eller forsinkede indberetninger
- Skatte- eller afgiftsrestancer, hvor ChainGuard lovligt kan få oplysningerne
- Ændringer i registrering eller virksomhedsstatus

### Adgangsmodel

Der skal være to muligheder:

**Automatisk myndighedsadgang** — bruges, hvis Skattestyrelsen stiller den konkrete systemadgang
til rådighed, og ChainGuard er godkendt til den.

**Delegeret adgang eller dokumentation** — virksomhedens TastSelv-administrator giver ChainGuard
eller en godkendt samarbejdspartner adgang til præcist definerede områder.

Skattestyrelsen kræver særskilt autorisation til forskellige områder, og eIndkomst følger særlige
adgangsprocedurer. Det kan derfor **ikke** erstattes af en generel MitID-underskrift.

### Vis ikke rå skattedata til hovedvirksomheden

Hovedvirksomheden skal eksempelvis se:

| Kontrol | Resultat |
| --- | --- |
| Momsregistreret | Ja |
| Arbejdsgiverregistreret | Ja |
| Lønindberetninger modtaget | Ja |
| Væsentlige forsinkelser | Nej |
| Dokumentation kontrolleret | 22. august 2026 |

Den skal ikke have fri adgang til leverandørens TastSelv-oplysninger.

---

## 5. Bankadgang

### Formålet må være præcist

Bankadgangen skal kun bruges til at kontrollere:

- At kontoen tilhører virksomheden
- At fakturakontoen matcher den verificerede konto
- At nettoløn er udbetalt
- At beløb og dato matcher lønmaterialet
- Om løn overføres samlet eller individuelt
- Om der forekommer mistænkelige betalinger tilbage til virksomheden
- Om virksomhedens betalingskonto ændres

ChainGuard skal **ikke** give kunden adgang til hele leverandørens kontohistorik.

### Teknisk løsning

Bankforbindelsen skal etableres gennem:

- En autoriseret kontooplysningstjeneste
- En reguleret open-banking-partner
- Eller ChainGuards egen tilladelse, hvis det senere bliver økonomisk relevant

Kontoadgang efter PSD2 kræver bankens eget samtykkeforløb. Et MitID-underskrevet mandat kan derfor
ikke alene aktivere bankadgangen. Kontoinformation er en reguleret betalingstjeneste.

### Den bedste datamodel

ChainGuard bør gemme:

- Kontoejer verificeret: ja/nej
- Kontoens sidste fire cifre
- Forbindelsens udløbsdato
- Lønudbetaling matchet: ja/nej
- Antal afvigelser
- Kontroltidspunkt

Undgå permanent lagring af hele kontoudtog, hvis kontrolresultaterne er tilstrækkelige.

---

## 6. Ansatte, lønsedler og timer

Dette er ChainGuards vigtigste kontrolområde.

### Data skal helst hentes fra lønsystemet

Lav integrationer til de mest anvendte systemer, eksempelvis:

- DataLøn
- Danløn
- Zenegy
- Salary
- Dataløn/Visma-løsninger
- e-conomic-løntilknytninger
- Udenlandske lønsystemer senere

Manuel PDF-upload skal være en **reservefunktion** — ikke den primære proces.

### For hver medarbejder skal ChainGuard kontrollere

- Unikt pseudonymiseret medarbejder-ID
- Ansættelsesperiode
- Jobfunktion eller faggruppe
- Løntype
- Normale timer
- Overarbejdstimer
- Timeløn eller månedsløn
- Tillæg
- Feriepenge
- Pension
- ATP
- Bruttoløn
- Nettoløn
- Lønperiode
- Udbetalingsdato
- Om lønnen er indberettet
- Om nettolønnen er udbetalt
- Om medarbejderen var registreret på projektet

### Systemet skal sammenholde fire kilder

| Kilde | Kontrol |
| --- | --- |
| Tidsregistrering | Faktisk arbejdstid og projekt |
| Lønsystem | Beregnet løn, tillæg og fradrag |
| eIndkomst eller anden dokumentation | Indberettet løn og medarbejdere |
| Bank | Faktisk udbetalt nettoløn |

En medarbejder bliver først grøn, når oplysningerne hænger sammen.

### Vigtige automatiske afvigelser

- Timer findes, men medarbejderen findes ikke i lønsystemet
- Medarbejderen arbejder før ansættelsesdatoen
- Nettolønnen er ikke udbetalt
- Bankbeløbet afviger fra lønsedlen
- Timerne overstiger fastsatte grænser
- Overarbejdstillæg mangler
- Pension eller feriepenge mangler
- Lønnen er lavere end det gældende kontrolgrundlag
- Flere ansatte får løn på samme bankkonto
- Lønseddel er ændret efter upload
- Samme medarbejder optræder samtidigt hos flere leverandører
- Antal ansatte på byggepladsen overstiger antal lønregistrerede

### Medarbejdernes persondata

Virksomhedens MitID-underskrift er ikke nødvendigvis et gyldigt grundlag for at udlevere alle
medarbejdernes personoplysninger.

ChainGuard skal derfor:

- Dokumentere behandlingsgrundlaget
- Indgå databehandleraftaler
- Give medarbejderne den nødvendige information
- Pseudonymisere medarbejderne over for hovedvirksomheden
- Skjule CPR-numre, skatteforhold, bankkonti og andre uvedkommende data
- Have automatiske slettefrister
- Gennemføre en konsekvensanalyse, før omfattende løn- og bankovervågning sættes i drift

**Brug ikke medarbejdersamtykke som standardløsning.** Samtykke i et ansættelsesforhold kan være
problematisk, fordi medarbejderen ikke nødvendigvis har et frit valg. Få i stedet det konkrete
behandlingsgrundlag vurderet juridisk.

---

## 7. Overenskomst og lønvilkår

Der findes ikke ét komplet offentligt register, hvor ChainGuard kan slå alle virksomheders
overenskomster op. Derfor skal systemet arbejde med et **dokumenteret kontrolgrundlag**.

### Virksomheden vælger én af tre statusser

- Omfattet af kollektiv overenskomst
- Tiltrædelsesoverenskomst
- Ikke overenskomstdækket

### Hvis virksomheden er dækket

Indhent: overenskomstens navn, fagforbund og arbejdsgiverorganisation, gyldighedsperiode,
virksomhedens tiltrædelsesdokument, faggrupper, lønsatser, tillæg, pension, ferie/fridage samt
arbejdstid og overarbejde.

### Hvis virksomheden ikke er dækket

Hovedvirksomheden skal kunne definere sit kontraktuelle kontrolgrundlag, eksempelvis mindsteløn,
pension, feriepenge, overarbejdstillæg, arbejdstid, rejse/kost/logi samt krav fra udbud eller
arbejdsklausul.

ChainGuard skal ikke vise "overenskomstbrud", hvis virksomheden ikke er omfattet. Vis i stedet:
**Afvigelse fra kontraktens løn- og arbejdsvilkår.**

### Regelbibliotek

Alle satser skal have: kilde, version, ikrafttrædelsesdato, udløbsdato, faggruppe, geografisk eller
kontraktmæssigt område, godkendt af og ændringshistorik.

Lønkontroller skal altid kunne **reproduceres med den regelversion, der gjaldt i den kontrollerede
lønperiode**.

---

## 8. RUT-kontrol

RUT-kontrol aktiveres kun for udenlandske virksomheder eller relevante selvstændige.

### ChainGuard skal kontrollere

- RUT-nummer
- Virksomhedsidentitet
- Arbejdssted
- Kunde/hvervgiver
- Arbejdets art
- Start- og slutdato
- Kontaktperson
- Antal medarbejdere
- Om anmeldelsen dækker det konkrete projekt
- Om ændringer er registreret
- Om registreringen udløber under projektet

Udenlandske virksomheder, der midlertidigt arbejder i Danmark, skal som udgangspunkt registrere
opgaven i RUT. En række oplysninger er offentlige. Hvervgiveren skal se dokumentation for
RUT-anmeldelse; hvis dokumentationen mangler, gælder der i relevante tilfælde en frist på tre dage
efter arbejdets begyndelse til at underrette Arbejdstilsynet.

### Automatiske alarmer

- Ingen RUT-registrering
- Forkert arbejdssted
- Forkert kunde
- Udløbet registrering
- Arbejde startet før registrering
- Registreringen omfatter ikke hele projektperioden
- Uoverensstemmelse mellem medarbejderantal og løndata

---

## 9. Forsikringskontrol

Forsikringsoplysninger kan ikke forventes hentet samlet via MitID.

### ChainGuard skal indhente

Forsikringsselskab, policenummer, forsikringstype, forsikringstager, dækningssum, selvrisiko,
geografisk dækning, erhvervsaktiviteter, ikrafttrædelsesdato, udløbsdato, opsigelsesstatus og
dokumentudsteder.

### Relevante forsikringer

Afhængigt af kontrakten: arbejdsskadeforsikring, erhvervsansvar, produktansvar, entrepriseforsikring,
professionelt ansvar, motoransvar og transportøransvar.

### Bedste verifikation

1. Direkte bekræftelse fra forsikringsselskab eller mægler
2. Forsikrings-API
3. Digital policemeddelelse sendt direkte til ChainGuard
4. Uploadet police med efterfølgende kontrol
5. Virksomhedens egen erklæring — kun midlertidig status

En uploadet police må **aldrig alene** få status "verificeret", hvis den ikke kan valideres hos
udstederen.

---

## 10. Compliance-status

Brug kun fire hovedstatusser.

**Grøn — Godkendt:** alle obligatoriske kontroller bestået, ingen kritiske afvigelser, alle
datatilslutninger aktive.

**Gul — Handling kræves:** dokument udløber snart, mindre dataafvigelse, ny lønperiode mangler,
forbindelse skal fornyes, manuel vurdering kræves.

**Rød — Ikke compliant:** manglende lønudbetaling, manglende RUT, ugyldig forsikring, alvorlig
lønafvigelse, virksomheden er ophørt eller under konkurs, nødvendig adgang er trukket tilbage,
dokumenteret manipulation.

**Grå — Kan ikke vurderes:** data mangler, integration er nede, virksomheden har endnu ikke
gennemført onboarding, kontrollen er ikke relevant eller ikke mulig.

**Grå må aldrig automatisk blive behandlet som grøn.**

---

## 11. Risikoscore

Den overordnede score skal understøtte beslutningen — ikke skjule afvigelserne.

| Område | Vægt |
| --- | --- |
| Virksomhedsstatus | 10 % |
| Skat og registreringer | 20 % |
| Ansatte og løn | 30 % |
| Bankmatch | 15 % |
| Overenskomst/arbejdsvilkår | 10 % |
| RUT | 10 % |
| Forsikringer | 5 % |

Kritiske fejl skal **overstyre** den samlede score. Manglende lønudbetaling må eksempelvis give rød
status, selv hvis resten af virksomheden scorer højt.

Vis altid: samlet status, kritiske afvigelser, sidst kontrolleret, datadækning og næste nødvendige
handling.

---

## 12. Løbende overvågning

### Ved hændelser

Kør straks kontrol når: bankkonto ændres, forsikring opsiges eller udløber, virksomhedsstatus
ændres, ny underleverandør tilføjes, nyt løngrundlag indlæses, RUT-oplysninger ændres, eller
datadeling tilbagekaldes.

### Fast kontrol

| Område | Frekvens |
| --- | --- |
| CVR og virksomhed | Dagligt |
| Bankforbindelse | Dagligt eller efter lønkørsel |
| Løn og ansatte | Hver lønperiode |
| RUT | Dagligt under aktive projekter |
| Forsikringer | Månedligt og før udløb |
| Overenskomstsatser | Ved nye versioner |
| Samtykke, mandat og forbindelser | Dagligt |

### Før betaling af faktura

ChainGuard skal kunne sende ét enkelt signal til økonomisystemet: **Frigiv betaling · Hold betaling ·
Kræver manuel godkendelse.**

Systemet bør ikke selv blokere betalinger uden en kontraktligt fastlagt regel og menneskelig
mulighed for at behandle fejl.

---

## 13. Dashboardet

Hovedsiden skal kun vise: antal aktive virksomheder; grønne, gule, røde og grå; kritiske afvigelser;
virksomheder med udløbende dokumentation; nye hændelser; leverandører, der mangler onboarding.

### Virksomhedssiden

Øverst: virksomhedsnavn og CVR, samlet status, projekt, sidste kontrol, næste kontrol og de tre
vigtigste handlinger.

Derefter kun seks kontrolkort:

1. Virksomhed og skat
2. Bank
3. Ansatte og løn
4. Arbejdsvilkår
5. RUT
6. Forsikring

Hvert kort viser status, kontroltidspunkt, datakilde, afvigelser samt knapperne
**"Se dokumentation"** og **"Anmod om rettelse"**.

Undgå at vise 50 separate flueben på forsiden.

---

## 14. Dokumentation og revisionsspor

Hver kontrol skal gemme: hvad der blev kontrolleret, datakilde, kontroltidspunkt, regelversion,
resultat, afvigelse, hvem der vurderede sagen, hvem der ændrede status, begrundelse, dokumentets
digitale fingeraftryk, om dokumentet senere er ændret, og hvornår data skal slettes.

**Ingen må kunne ændre historiske resultater.** En rettelse skal oprette en ny version.

ChainGuard skal kunne generere en rapport for en bestemt virksomhed, et projekt og en periode.

---

## 15. Sikkerhed og GDPR

Før lancering bør følgende være på plads:

- Konsekvensanalyse/DPIA
- Databehandleraftaler
- Klar rollefordeling mellem hovedvirksomhed, leverandør og ChainGuard
- Fortegnelse over behandlinger
- Adgang efter mindste nødvendige rettighed
- Kryptering under transport og lagring
- Separat kryptering af CPR-, løn- og bankdata
- Pseudonymisering af medarbejdere
- Automatisk sletning
- Logning af alle opslag
- Tofaktorgodkendelse
- Årlig sikkerhedstest
- Procedure for sikkerhedsbrud
- Dataplacering i EU/EØS
- Forbud mod at bruge kundernes løn- og medarbejderdata til generel AI-træning

Data skal slettes efter dokumenterede frister, når de ikke længere er nødvendige. Datatilsynet
anbefaler faste rutiner for løbende sletning.

---

## 16. Det realistiske MVP

Byg ikke alle myndighedsintegrationer fra første dag.

### Version 1

- CVR-onboarding
- MitID Erhverv-underskrevet kontrolmandat
- Virksomhedsinvitationer
- Lønseddel- og dokumentupload
- CSV-import fra lønsystem
- Bankkontobekræftelse
- RUT-kontrol
- Forsikringskontrol
- Regelbaseret lønkontrol
- Dashboard og revisionsrapport
- Manuel behandling af undtagelser

### Version 2

- Direkte lønsystemintegrationer
- Open-banking-integration
- Automatisk dokumentaflæsning
- Projekt- og tidsregistrering
- Automatisk genkontrol
- Integration til økonomi- og ERP-systemer

### Version 3

- Delegeret skatte-/eIndkomst-adgang, hvor det juridisk og teknisk kan etableres
- Forsikringsselskabsintegrationer
- Grænseoverskridende kontrol
- Automatisk kortlægning af hele leverandørkæden
- Anonymiseret benchmarking og risikomodeller

---

## Skarp anbefaling

ChainGuards vigtigste konkurrencemæssige fordel bør være denne kontrol:

> Arbejdet medarbejderen reelt har udført → timerne → lønsedlen → indberetningen → bankudbetalingen
> → den korrekte lønregel.

Det er her, systemet kan opdage social dumping og dokumentmanipulation. Et almindeligt dokumentarkiv
med grønne flueben er let at kopiere og giver langt mindre værdi.

"Én godkendelse" skal være **én samlet brugeroplevelse** — ikke et løfte om, at MitID juridisk åbner
alle datakilder.

---

## 17. Status i den nuværende kodebase (august 2026)

Oversigten er en øjebliksbeskrivelse af, hvad der findes i `server.js`, `db.js` og `public/index.html`
i dag, holdt op mod Version 1 ovenfor. Den er ikke en del af selve specifikationen og skal opdateres,
når funktionalitet lander.

| Spec-område | Nuværende status | Findes i dag |
| --- | --- | --- |
| CVR-onboarding | Delvist | `GET /api/cvr/:cvr`, `GET /api/cvr/search/:query` |
| MitID Erhverv-mandat | Mangler | Kun e-mail/password-login (`users`, `/api/auth/*`) |
| Virksomheds-/leverandørstyring | Delvist | `suppliers`-tabel, `/api/suppliers` (CRUD) |
| Projekter og leverandørkæde | Delvist | `cases`, `case_subcontractors`, `/api/cases/:id/chain` |
| Dokumentupload | Delvist | `documents`, `POST /api/documents/upload` (ingen hash/versionering) |
| Løn- og medarbejderkontrol | Mangler | Kun `apprentices` (lærlinge, sync-model) |
| Bankkontrol | Mangler | — |
| Skat/eIndkomst | Mangler | — |
| RUT-kontrol | Mangler | — |
| Forsikringskontrol | Mangler | — |
| Overenskomst/regelbibliotek | Mangler | — |
| Afvigelser | Delvist | `deviations`, `/api/deviations` (manuelt oprettede) |
| Compliance-status og score | Delvist | `compliance_results`, `POST /api/compliance/check` |
| Fire-status-model (grøn/gul/rød/grå) | Delvist | `suppliers.status`/`status_class` bruger andre værdier |
| Revisionsspor | Delvist | `audit_log` (ingen regelversion, hash eller slettefrist) |
| Rapport/eksport | Ja | `GET /api/export/pdf`, `/api/export/csv/*`, `compliance_archive` |
| Løbende overvågning | Delvist | `node-cron` + `/api/compliance/settings` |
| Roller (hovedvirksomhed/leverandør/kontrollør) | Delvist | `users.role` er i dag `admin`/`user`/`investor` — ikke spec'ens tre roller |

### Nærmeste skridt mod Version 1

1. Rollemodel og adgangskontrol, så leverandør og hovedvirksomhed ser forskellige data.
2. Kontrolmandat som datamodel (omfang, periode, tilbagekaldelse) — først som dokumenteret
   underskrift, senere MitID Erhverv.
3. Fire-status-model og kritiske afvigelser, der overstyrer scoren.
4. Løndatamodel (medarbejder, lønperiode, timer, brutto/netto) med CSV-import som første kilde.
5. Revisionsspor udvidet med regelversion, dokument-hash og slettefrist.
