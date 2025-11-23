import { useContext } from "react";
import { CollabContext } from "../context/CollabContext";

export function useCollab() {
  return useContext(CollabContext);
}
