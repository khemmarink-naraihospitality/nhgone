/**
 * Mock arrivals for the kiosk's guest-picker flow (search -> confirm ->
 * registration). Still a prototype: nothing here comes from MEWS - see the
 * file-level notes on the pages that read this. Six guests, six rows,
 * matching a real reference screenshot of the terminal in the field
 * (17-Sep-2026), including the day-of-week/date pairs shown there.
 *
 * "PATTARAVADEE Test" is that reference's own obviously-a-staff-test booking
 * (the name says so), and its email is copied verbatim because the
 * reference shows it. The other five guests' emails are NOT in any
 * reference - the reference only walks through PATTARAVADEE Test's own
 * registration screen in detail - so those are placeholder @example.com
 * addresses rather than a guess at a real guest's real contact details.
 *
 * Room type is "Comfy" for all six: the one confirm-screen reference names
 * that category for PATTARAVADEE Test, and there is nothing to say any of
 * the other five are in a different one.
 */

export interface MockGuest {
  id: string;
  name: string;
  guestCount: number;
  arrivalShort: string;
  departureShort: string;
  room: string;
  checkoutFull: string;
  email: string;
}

export const MOCK_GUESTS: MockGuest[] = [
  {
    id: "1",
    name: "PATTARAVADEE Test",
    guestCount: 2,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Fri, Sep 18",
    room: "Comfy",
    checkoutFull: "Friday, September 18, 12:00 PM",
    email: "pattaravadee.n@lubd.com",
  },
  {
    id: "2",
    name: "Aviel Siman-Tov",
    guestCount: 1,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Sat, Sep 19",
    room: "Comfy",
    checkoutFull: "Saturday, September 19, 12:00 PM",
    email: "aviel.simantov@example.com",
  },
  {
    id: "3",
    name: "Jessica Steinberg",
    guestCount: 1,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Tue, Sep 22",
    room: "Comfy",
    checkoutFull: "Tuesday, September 22, 12:00 PM",
    email: "jessica.steinberg@example.com",
  },
  {
    id: "4",
    name: "Aisa Khor",
    guestCount: 2,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Mon, Sep 21",
    room: "Comfy",
    checkoutFull: "Monday, September 21, 12:00 PM",
    email: "aisa.khor@example.com",
  },
  {
    id: "5",
    name: "Sonia Khondokar",
    guestCount: 2,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Tue, Sep 22",
    room: "Comfy",
    checkoutFull: "Tuesday, September 22, 12:00 PM",
    email: "sonia.khondokar@example.com",
  },
  {
    id: "6",
    name: "Liat Tiat",
    guestCount: 2,
    arrivalShort: "Thu, Sep 17",
    departureShort: "Sun, Sep 20",
    room: "Comfy",
    checkoutFull: "Sunday, September 20, 12:00 PM",
    email: "liat.tiat@example.com",
  },
];

export function findMockGuest(id: string | null): MockGuest | null {
  return MOCK_GUESTS.find((g) => g.id === id) || null;
}
