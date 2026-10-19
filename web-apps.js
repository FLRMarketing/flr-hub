/* ============================================================================
   The marks of the everyday websites that are Hub apps (Outlook, Monday.com,
   HubSpot, SharePoint). Since Hub migration 2.6 they are Hub tiles in the
   database, like FLR's own apps: their names, addresses and order are there,
   each person gets the ones switched on for them in Hub settings, and new
   accounts get them as part of "New accounts get". This file only gives each
   one its official mark, in white, saved in assets/web-apps/ (never loaded from
   the site), for the Hub home and Hub settings. Its colour is in hub.css
   (.app-icon--<id>). A website tile without a mark here gets the tile icon.
   ========================================================================== */
window.FLR_WEB_APPS = Object.freeze([
  { id: 'outlook', logo: 'assets/web-apps/outlook-white.svg' },
  { id: 'monday', logo: 'assets/web-apps/monday-white.png' },
  { id: 'hubspot', logo: 'assets/web-apps/hubspot-white.svg' },
  { id: 'sharepoint', logo: 'assets/web-apps/sharepoint-white.svg' },
].map(Object.freeze));
