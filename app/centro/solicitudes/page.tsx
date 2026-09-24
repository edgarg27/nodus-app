import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("solicitudes", ["admin", "superadmin", "gerente"]);
}
