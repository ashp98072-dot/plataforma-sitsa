import {requireTenantCalendario} from '@/lib/tenant';
import {ConfiguracionResultado} from '@/components/contabilidad/configuracion-resultado';
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const g=await requireTenantCalendario(slug,'ver');if(g.error)return <p>Sin acceso a configuración contable.</p>;return <ConfiguracionResultado key={slug} slug={slug}/>;}
