/* ============================================================================
   Websites FLR staff use every day, shown among "Your tools" on the Hub home
   after FLR's own apps, drawn the same way (an app icon with the name under it).
   This list is the only place they're set; the order here is the order they
   appear in. To add one, add an entry; to reorder, move it.
     id     short name, letters and dashes (also the icon's colour: hub.css
            .app-icon--<id>)
     name   as people know it
     note   a few words for the card that rises from the icon (optional)
     url    the FLR workspace or site, https only. An entry without a url isn't
            shown.
     logo   the site's own mark in white, saved in assets/web-apps/ (never
            loaded from the site itself)
   These are plain links that open in a new tab. Each website does its own
   sign-in and decides who gets in, so there's nothing to switch on per person in
   Hub settings, and the Hub sends nothing to them.
   ========================================================================== */
window.FLR_WEB_APPS = Object.freeze([
  { id: 'outlook', name: 'Outlook', note: 'FLR email and calendar.', url: 'https://outlook.office.com/mail/', logo: 'assets/web-apps/outlook-white.svg' },
  { id: 'monday', name: 'Monday.com', note: 'FLR’s boards on monday.com.', url: 'https://flr-group-company.monday.com/', logo: 'assets/web-apps/monday-white.png' },
  { id: 'hubspot', name: 'HubSpot', note: 'FLR contacts, companies and deals.', url: 'https://app.hubspot.com/contacts/4983883', logo: 'assets/web-apps/hubspot-white.svg' },
  { id: 'sharepoint', name: 'SharePoint', note: 'FLR’s shared files and pages.', url: 'https://flrfloors.sharepoint.com/SitePages/Home.aspx', logo: 'assets/web-apps/sharepoint-white.svg' },
].map(Object.freeze));
