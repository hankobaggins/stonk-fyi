import { redirect } from "next/navigation";

// /yield merged into /tokens on 2026-09-11: the APR columns are on every token row there, and the
// "Yield" sort is the old ranking. Kept as a redirect so shared links and the nav history still work.
export default function YieldPage() {
  redirect("/tokens?sort=yield");
}
