import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("invitados", ["admin", "superadmin", "gerente"]);
}
