import {requireTenantCalendario} from '@/lib/tenant';
import {ControlPeriodos} from '@/components/contabilidad/control-periodos';
export default async function PeriodosPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;const guard=await requireTenantCalendario(slug,'ver');
  if(guard.error)return <p>Sin acceso al control de períodos.</p>;
  return <ControlPeriodos key={slug} slug={slug} actorId={guard.session.id}/>;
}
