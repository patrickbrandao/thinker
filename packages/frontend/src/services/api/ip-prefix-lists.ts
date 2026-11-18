import { fetchJson, fetchMutate, type FetchMutateOptions } from './core.js';

/** Organization IP prefix lists and the per-harness source IP restriction. */

export interface IpPrefixEntry {
  prefix: string;
  label: string | null;
}

export interface HarnessRef {
  name: string;
  displayName: string;
}

export interface IpPrefixListView {
  id: string;
  name: string;
  description: string | null;
  entries: IpPrefixEntry[];
  /** Harnesses whose IP restriction uses this list. */
  harnesses: HarnessRef[];
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

export const ipPrefixListPath = (id: string) => `/ip-prefix-lists/${encodeURIComponent(id)}`;

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

/** 409 when harnesses still use the list; the caller shows which ones. */
export function deleteIpPrefixList(id: string, opts?: FetchMutateOptions) {
  return fetchMutate<{ ok: true }>(ipPrefixListPath(id), { method: 'DELETE' }, opts);
}

const restrictionPath = (agentName: string) =>
  `/agents/${encodeURIComponent(agentName)}/ip-restriction`;

export function getIpRestriction(agentName: string) {
  return fetchJson<IpRestriction>(restrictionPath(agentName));
}

export function updateIpRestriction(agentName: string, body: IpRestriction) {
  return fetchMutate<IpRestriction>(restrictionPath(agentName), {
    method: 'PUT',
    headers: json,
    body: JSON.stringify(body),
  });
}
