import { notFound } from "next/navigation";

/** Unknown addresses inside the shell get the in-shell not-found page. */
export default function MissingPage() {
  notFound();
}
