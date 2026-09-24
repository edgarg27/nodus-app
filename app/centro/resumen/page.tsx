import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("resumen", ["admin", "sistemas", "operaciones", "superadmin", "gerente"]);
}
