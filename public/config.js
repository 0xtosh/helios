/* Optional UI settings. Edit and reload the page; no server restart needed.
 *   lat, lon       your location, for the automatic light/dark theme (sunrise/sunset).
 *                  Leave null to follow the system light/dark preference.
 *   priorityRooms  room names (case-insensitive regex) shown first, in this order. */
window.HELIOS = {
  lat: null,
  lon: null,
  priorityRooms: ['living', 'kitchen'],
};
