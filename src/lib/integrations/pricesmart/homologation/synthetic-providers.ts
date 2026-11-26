import { labCipher, labEvidencePort, labVerifier } from '../lab-demo/lab-crypto';
import { labContract } from '../lab-demo/contract';
import type { HomologationProviders } from './providers';

// SOLO PRUEBAS LOCALES. Verificador HMAC de laboratorio, cifrado de prueba y contrato `lab-demo-1`. Este archivo SOLO se importa de forma diferida desde `providers.ts` cuando `syntheticProvidersDecision` lo permite
// (proceso que NO es `next start`, frase explícita, sandbox `homolog-test*`, clave de prueba): jamás en un sandbox expuesto a PriceSmart (su verificador es D02 y el HMAC de laboratorio está prohibido externamente).
export function createSyntheticProviders(key: string): HomologationProviders {
  return { evidence: labEvidencePort(), verifier: labVerifier(key), cipher: labCipher(key), contract: labContract };
}
