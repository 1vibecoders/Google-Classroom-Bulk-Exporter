// Google sign-in (OAuth 2.0 authorization code flow with PKCE, run on the
// server) and the Classroom REST API, with plain fetch.
//
// Scopes: only what the sync reads (SPEC.md § 12.1), the same content the
// browser extension exports (attachment files themselves are not downloaded).
//   openid, email                              who signed in
//   classroom.courses.readonly                 the person's courses
//   classroom.coursework.me.readonly           coursework and the person's own submissions
//   classroom.courseworkmaterials.readonly     class materials
//   classroom.announcements.readonly           announcements
//   classroom.topics.readonly                  topic names
//
// The Classroom API has no "changed since" filter for coursework, so the sync
// compares stable ids and content fingerprints instead (server/sync.ts).

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CLASSROOM = 'https://classroom.googleapis.com/v1';

export interface GoogleDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface GoogleTime {
  hours?: number;
  minutes?: number;
}

export interface Course {
  id: string;
  name: string;
  section?: string;
  room?: string;
  description?: string;
  alternateLink?: string;
  courseState?: string;
}

export interface Material {
  driveFile?: { driveFile?: { title?: string; alternateLink?: string } };
  youtubeVideo?: { title?: string; alternateLink?: string };
  link?: { title?: string; url?: string };
  form?: { title?: string; formUrl?: string };
}

export interface CourseWork {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  state?: string;
  alternateLink?: string;
  dueDate?: GoogleDate;
  dueTime?: GoogleTime;
  maxPoints?: number;
  workType?: string;
  materials?: Material[];
  topicId?: string;
  updateTime?: string;
}

export interface CourseWorkMaterial {
  id: string;
  title?: string;
  alternateLink?: string;
  materials?: Material[];
}

export interface Announcement {
  id: string;
  text?: string;
  alternateLink?: string;
  creationTime?: string;
  materials?: Material[];
}

export interface Topic {
  topicId: string;
  name?: string;
}

export interface StudentSubmission {
  courseWorkId: string;
  state?: string;
}

/** Newest announcements kept per class (the format allows 100). */
export const ANNOUNCEMENT_LIMIT = 20;

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope: string;
}

export interface Identity {
  sub: string;
  email: string;
}

/** A failed Google call. `transient` errors may succeed when retried later. */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

export interface GoogleApi {
  authUrl(options: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<string>;
  listCourses(accessToken: string): Promise<Course[]>;
  listCourseWork(accessToken: string, courseId: string): Promise<CourseWork[]>;
  listMaterials(accessToken: string, courseId: string): Promise<CourseWorkMaterial[]>;
  listAnnouncements(accessToken: string, courseId: string): Promise<Announcement[]>;
  listTopics(accessToken: string, courseId: string): Promise<Topic[]>;
  listSubmissions(accessToken: string, courseId: string): Promise<StudentSubmission[]>;
  revoke(token: string): Promise<void>;
}

/** Reads the identity from an ID token received directly from Google's token endpoint over TLS. */
export function identityFromIdToken(idToken: string, clientId: string, nowSeconds = Date.now() / 1000): Identity {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  const issuerOk = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (!issuerOk || payload.aud !== clientId || typeof payload.exp !== 'number' || payload.exp < nowSeconds) {
    throw new GoogleError('The sign-in response from Google could not be verified.', 400, 'bad_id_token', false);
  }
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new GoogleError('Google did not share the account’s email address.', 400, 'no_email', false);
  }
  return { sub: payload.sub, email: payload.email };
}

type Fetch = typeof fetch;

export function googleApi(options: { clientId: string; clientSecret: string; fetch?: Fetch; retryDelaysMs?: number[] }): GoogleApi {
  const doFetch = options.fetch ?? fetch;
  const delays = options.retryDelaysMs ?? [400, 1200];

  // Retries rate limits, server errors and network failures with bounded backoff.
  async function call(url: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      try {
        response = await doFetch(url, init);
      } catch {
        response = null;
      }
      if (response && response.ok) return response.status === 204 ? null : response.json();
      const status = response?.status ?? 0;
      const transient = status === 0 || status === 429 || status >= 500;
      if (!transient || attempt >= delays.length) {
        let reason = status === 0 ? 'network' : `http_${status}`;
        let message = status === 0 ? 'Google could not be reached.' : `Google answered with an error (${status}).`;
        try {
          const body = (await response?.json()) as { error?: string | { message?: string; status?: string; details?: Array<{ reason?: string }> }; error_description?: string } | undefined;
          if (typeof body?.error === 'string') reason = body.error;
          else if (body?.error) {
            reason = body.error.details?.find((d) => d.reason)?.reason ?? body.error.status ?? reason;
            if (body.error.message) message = body.error.message;
          }
        } catch {
          /* not JSON */
        }
        throw new GoogleError(message, status, reason, transient);
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  async function token(params: Record<string, string>): Promise<Record<string, string>> {
    return (await call(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }),
    })) as Record<string, string>;
  }

  async function list<T>(url: string, accessToken: string, key: string, max = Infinity): Promise<T[]> {
    const out: T[] = [];
    let pageToken = '';
    do {
      const page = (await call(pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url, {
        headers: { authorization: `Bearer ${accessToken}` },
      })) as Record<string, unknown>;
      out.push(...((page[key] as T[] | undefined) ?? []));
      pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }

  return {
    authUrl: ({ clientId, redirectUri, state, codeChallenge }) =>
      `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      })}`,
    async exchangeCode(code, codeVerifier, redirectUri) {
      const t = await token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri });
      return { accessToken: t.access_token, refreshToken: t.refresh_token, idToken: t.id_token, scope: t.scope ?? '' };
    },
    async refresh(refreshToken) {
      return (await token({ grant_type: 'refresh_token', refresh_token: refreshToken })).access_token;
    },
    listCourses: (accessToken) => list<Course>(`${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=100`, accessToken, 'courses'),
    listCourseWork: (accessToken, courseId) =>
      list<CourseWork>(`${CLASSROOM}/courses/${encodeURIComponent(courseId)}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`, accessToken, 'courseWork'),
    listMaterials: (accessToken, courseId) =>
      list<CourseWorkMaterial>(`${CLASSROOM}/courses/${encodeURIComponent(courseId)}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED&pageSize=100`, accessToken, 'courseWorkMaterial'),
    listAnnouncements: (accessToken, courseId) =>
      list<Announcement>(
        `${CLASSROOM}/courses/${encodeURIComponent(courseId)}/announcements?announcementStates=PUBLISHED&orderBy=updateTime%20desc&pageSize=${ANNOUNCEMENT_LIMIT}`,
        accessToken,
        'announcements',
        ANNOUNCEMENT_LIMIT,
      ),
    listTopics: (accessToken, courseId) => list<Topic>(`${CLASSROOM}/courses/${encodeURIComponent(courseId)}/topics?pageSize=100`, accessToken, 'topic'),
    listSubmissions: (accessToken, courseId) =>
      list<StudentSubmission>(`${CLASSROOM}/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions?userId=me&pageSize=100`, accessToken, 'studentSubmissions'),
    async revoke(tokenValue) {
      await call(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokenValue }) });
    },
  };
}
