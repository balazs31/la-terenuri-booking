// sportinclujnapoca.ro facilities and complexes (public tables `facilities`, `sports_complexes`,
// RPC `get_facilities_with_complexes`), snapshot 2026-10-06.
export interface Complex {
  id: string;
  name: string;
}

export interface Facility {
  id: string;
  name: string;
  slug: string;
  minPeople: number;
  complexes: string[]; // complex ids
}

const GHEORGHENI = "211fdc7a-166e-43c8-9c5a-75094878b63a";
const LA_TERENURI = "3181c65a-3ae6-4668-a7e7-32523d3c0d9e";

export const COMPLEXES: Complex[] = [
  { id: LA_TERENURI, name: "Baza Sportivă „La Terenuri”" },
  { id: GHEORGHENI, name: "Baza Sportivă Gheorgheni" },
];

export const FACILITIES: Facility[] = [
  { id: "1daabab3-899f-441c-b203-5ed29eb6662e", name: "Tenis", slug: "tennis", minPeople: 2, complexes: [LA_TERENURI, GHEORGHENI] },
  { id: "cc42eb74-0392-4175-b7d4-307e3c4406aa", name: "Tenis de masă", slug: "table-tennis", minPeople: 2, complexes: [LA_TERENURI, GHEORGHENI] },
  { id: "72744771-fa38-4bf3-8e75-07b113f374f3", name: "Tenis cu peretele", slug: "wall-tennis", minPeople: 1, complexes: [LA_TERENURI, GHEORGHENI] },
  { id: "5694df50-af33-4318-94f3-ba4bcaf1ff2d", name: "Squash", slug: "squash", minPeople: 1, complexes: [LA_TERENURI] },
  { id: "9a330eca-ad57-4ef9-87b2-62df601f6b8e", name: "Volei", slug: "volleyball", minPeople: 2, complexes: [LA_TERENURI] },
  { id: "742f59e9-0bd9-427a-8982-9d6fc1b62b1a", name: "Fotbal", slug: "football", minPeople: 4, complexes: [LA_TERENURI, GHEORGHENI] },
  { id: "90c10ab5-2bef-4f4d-adf7-a0cd32bb720c", name: "Baschet", slug: "basketball", minPeople: 4, complexes: [LA_TERENURI, GHEORGHENI] },
  { id: "682b3c7a-ab4b-40fe-aa1e-1287d3cda7f3", name: "Popice", slug: "skittles", minPeople: 1, complexes: [GHEORGHENI] },
];

/** Bookable start hours (1h slots, last one 21:00–22:00). */
export const HOURS = Array.from({ length: 13 }, (_, i) => 9 + i);

/** Days the site lets you book ahead. */
export const BOOKING_WINDOW_DAYS = 14;
