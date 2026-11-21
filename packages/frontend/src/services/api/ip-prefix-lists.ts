import { fetchJson, fetchMutate, type FetchMutateOptions } from './core.js';

/** Organization IP prefix lists and the per-key source IP restriction. */

export interface IpPrefixEntry {
  prefix: string;
  label: string | null;
}

export interface HarnessRef {
  name: string;
  displayName: string;
}

export interface IpAclKeyRef {
  id: string;
  name: string;
  harness: string;
  harnessDisplayName: string;
  /** IP ACLs the key is restricted to (1 = this one only). */
  listCount: number;
}

export interface IpPrefixListView {
  id: string;
  name: string;
  description: string | null;
  entries: IpPrefixEntry[];
  /** Harnesses with a key whose IP restriction uses this list. */
  harnesses: HarnessRef[];
  /** Keys (not revoked) whose IP restriction uses this list. */
  keys: IpAclKeyRef[];
  createdAt: string;
  updatedAt: string;
}

export interface IpPrefixListWrite {
  name?: string;
  description?: string | null;
  entries?: Array<{ prefix: string; label?: string | null }>;
}

export interface IpRestriction {
  enabled: boolean;
  listIds: string[];
}

const json = { 'Content-Type': 'application/json' };

const ipPrefixListPath = (id: string) => `/ip-prefix-lists/${encodeURIComponent(id)}`;

/** The IP ACL page with the editor window open on one list ('new' to create). */
export const ipAclEditPath = (id: string) => `/ip-prefix-lists?edit=${encodeURIComponent(id)}`;

export function listIpPrefixLists() {
  return fetchJson<{ lists: IpPrefixListView[] }>('/ip-prefix-lists');
}

export function getIpPrefixList(id: string) {
  return fetchJson<IpPrefixListView>(ipPrefixListPath(id));
}

export function createIpPrefixList(body: IpPrefixListWrite, opts?: FetchMutateOptions) {
  return fetchMutate<IpPrefixListView>(
    '/ip-prefix-lists',
    { method: 'POST', headers: json, body: JSON.stringify(body) },
    opts,
  );
}

export function updateIpPrefixList(id: string, body: IpPrefixListWrite, opts?: FetchMutateOptions) {
  return fetchMutate<IpPrefixListView>(
    ipPrefixListPath(id),
    { method: 'PATCH', headers: json, body: JSON.stringify(body) },
    opts,
  );
}

/**
 * 409 when API keys still use the list, unless `unlink`: then every key drops
 * it first (a key left with no list has its restriction turned off).
 */
export function deleteIpPrefixList(id: string, opts?: FetchMutateOptions, unlink = false) {
  return fetchMutate<{ ok: true; unlinkedKeys: number }>(
    `${ipPrefixListPath(id)}${unlink ? '?unlink=true' : ''}`,
    { method: 'DELETE' },
    opts,
  );
}

const restrictionPath = (agentName: string, keyId: string) =>
  `/agents/${encodeURIComponent(agentName)}/keys/${encodeURIComponent(keyId)}/ip-restriction`;

export function getIpRestriction(agentName: string, keyId: string) {
  return fetchJson<IpRestriction>(restrictionPath(agentName, keyId));
}

export function updateIpRestriction(agentName: string, keyId: string, body: IpRestriction) {
  return fetchMutate<IpRestriction>(restrictionPath(agentName, keyId), {
    method: 'PUT',
    headers: json,
    body: JSON.stringify(body),
  });
}
