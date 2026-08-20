# NHS England Emergency Department Performance Dashboard

An independent, interactive dashboard comparing urgent and emergency care
performance across England using publicly available NHS England data.

The dashboard deliberately keeps the following measures separate:

- **Type 1 major ED performance** from the monthly provider return
- **Type 3 / urgent-care performance** from the monthly provider return
- **Combined acute-trust-footprint performance** from NHS England's acute
  provider time series
- **Hospital-site measures** from the supplementary Emergency Care Data Set
  (ECDS) publications

This separation prevents a combined trust-footprint result from being presented
as if it represented the major Emergency Department alone.

## Live dashboard

After GitHub Pages is enabled, the dashboard will be available at:

`https://shahzadsalim.github.io/nhs-ed-performance-dashboard/`

## What the dashboard shows

- England-level Type 1 attendance and four-hour trends
- Trust-by-trust Type 1, urgent-care and combined-footprint measures
- Type 1/2 ED hospital-site performance from ECDS
- UTC/Type 3 hospital-site activity where published
- Twelve-hour waits from arrival and after decision to admit
- Paediatric ED and UTC performance where available
- Search and NHS region filters

## Data sources

- [NHS England A&E Attendances and Emergency Admissions](https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/)
- [NHS England Acute Provider Table](https://www.england.nhs.uk/statistics/statistical-work-areas/acute-provider-table/)
- Monthly provider CSV extracts
- Supplementary ECDS Activity and Performance workbooks

## Important methodology notes

- The monthly provider return separates Type 1, Type 2 and "Other A&E
  Department" activity. Booked and unbooked attendances are combined within
  each department type.
- The official acute-provider four-hour metric is shown separately. From April
  2026, NHS England bases this measure on the acute trust footprint, which may
  include attributed Type 3/UTC activity.
- ECDS site-level data are official statistics in development and may be
  provisional. Public ECDS four-hour performance currently focuses on Type 1
  and Type 2 sites; individual UTC four-hour performance is not consistently
  available for every site.
- The dashboard is descriptive. It is not an official NHS product and must not
  be used for individual clinical or operational decisions.

## Automatic monthly updates

The workflow in `.github/workflows/update-dashboard.yml` checks for new NHS
England data on the 13th, 16th and 20th of each month. It can also be run
manually from the **Actions** tab.

When a new publication is found, the workflow:

1. downloads the latest monthly and ECDS files;
2. recalculates the dashboard measures;
3. updates `dashboard.json`; and
4. commits the refreshed data to the repository.

## Local preview

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Repository structure

```text
index.html                 Dashboard page
styles.css                 Dashboard styling
app.js                     Charts, filters and tables
dashboard.json             Generated dashboard data
scripts/
  update_data.py           NHS England download and processing pipeline
.github/workflows/
  update-dashboard.yml     Scheduled monthly refresh
requirements.txt           Python dependencies
```

## Attribution

Contains public-sector information licensed under the Open Government Licence
v3.0. NHS England names are used only to identify published data sources. No NHS
logo is used.
