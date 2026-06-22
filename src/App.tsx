import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import "./App.css";
import {
  Alert,
  Button,
  CircularProgress,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

class ApiError extends Error {
  public fetch: boolean;

  public status?: number;

  public gqlErrors: { message: string }[];

  constructor(e: {
    message: string;
    cause?: unknown;
    fetch?: boolean;
    status?: number;
    gqlErrors?: { message: string }[];
  }) {
    super(e.message, e.cause !== undefined ? { cause: e.cause } : undefined);
    this.fetch = e.fetch ?? false;
    this.status = e.status;
    this.gqlErrors = e.gqlErrors ?? [];
  }
}

async function wrappedFetch(
  input: URL | RequestInfo,
  init?: RequestInit | undefined
) {
  let response: Response | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    response = await fetch(input, init);
    json = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    throw new ApiError({
      cause: e,
      message: "***You may not be connected to the internet***",
      fetch: true,
    });
  }
  if (!response.ok) {
    let keyErr = "";
    if (response.status === 400) {
      keyErr = " ***start.gg API key invalid!***";
    } else if (response.status === 401) {
      keyErr = " ***start.gg API key expired!***";
    }
    throw new ApiError({
      message: keyErr || response.statusText,
      status: response.status,
    });
  }
  return json;
}

type Tournament = {
  name: string;
  slug: string;
};

type Event = {
  id: number;
  name: string;
};

type Phase = {
  id: number;
  name: string;
  bracketType: string;
  progressingInData: {
    origin: number;
  }[];
  progressions:
    | {
        id: number;
      }[]
    | null;
};

type SilverSeed = {
  id: number;
  overallSeed: number;
};

async function fetchGql(
  key: string,
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variables: any
) {
  const json = await wrappedFetch("https://api.start.gg/gql/alpha", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (json.errors) {
    throw new ApiError({
      message: json.errors
        .map((error: { message: string }) => error.message)
        .join(", "),
      gqlErrors: json.errors,
    });
  }

  return json.data;
}

const GET_ADMINED_TOURNAMENTS_QUERY = `
  query TournamentsQuery {
    currentUser {
      tournaments(query: {perPage: 50, filter: {tournamentView: "admin"}}) {
        nodes {
          slug
          name
        }
      }
    }
  }
`;

const GET_TOURNAMENT_QUERY = `
  query TournamentQuery($slug: String) {
    tournament(slug: $slug) {
      events {
        id
        name
      }
    }
  }
`;

const GET_EVENT_QUERY = `
  query EventQuery($id: ID) {
    event(id: $id) {
      phases {
        id
        name
        bracketType
        progressingInData {
          origin
        }
        progressions {
          id
        }
      }
    }
  }
`;

const GET_POOLS_SEEDS_QUERY = `
  query poolsSeeds {
    phase(id: 2316237) {
      seeds(query: { page: 1, perPage: 512 }) {
        nodes {
          seedNum
          groupSeedNum
          phaseGroup {
            id
          }
        }
      }
    }
  }
`;

const GET_SILVER_SEEDS_QUERY = `
  query silverSeeds {
    phase(id: 2316239) {
      seeds(query: { page: 1, perPage: 512 }) {
        nodes {
          id
          progressionSource {
            originPlacement
            originPhaseGroup {
              id
            }
          }
        }
      }
    }
  }
`;

function App() {
  const [error, setError] = useState("");
  const [sggApiKey, setSggApiKey] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchGql(
          sggApiKey,
          GET_ADMINED_TOURNAMENTS_QUERY,
          {}
        );
        setError("");
        setTournaments(data.currentUser.tournaments.nodes ?? []);
      } catch (e: unknown) {
        setTournaments([]);
        if (e instanceof Error) {
          setError(e.message);
        }
      }
    })();
  }, [sggApiKey]);

  const [getting, setGetting] = useState(false);
  const [slug, setSlug] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const getTournament = useCallback(
    async (newSlug: string) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, GET_TOURNAMENT_QUERY, {
          slug: newSlug,
        });
        setError("");
        setSlug(newSlug);
        const newEvents = data.tournament.events;
        setEvents(newEvents ?? []);
      } catch (e: unknown) {
        if (e instanceof Error) {
          setError(e.message);
        }
      } finally {
        setGetting(false);
      }
    },
    [sggApiKey]
  );

  const [eventId, setEventId] = useState(0);
  const [phases, setPhases] = useState<Phase[]>([]);
  const getEvent = useCallback(
    async (newEventId: number) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, GET_EVENT_QUERY, {
          id: newEventId,
        });
        setError("");
        setEventId(newEventId);
        setPhases(data.event.phases ?? []);
      } catch (e: unknown) {
        if (e instanceof Error) {
          setError(e.message);
        }
      } finally {
        setGetting(false);
      }
    },
    [sggApiKey]
  );

  const rrPoolsPhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "ROUND_ROBIN" &&
          phase.progressions !== null &&
          phase.progressions.length > 0
      ),
    [phases]
  );
  const [poolsPhaseId, setPoolsPhaseId] = useState(0);

  const sePhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "SINGLE_ELIMINATION" &&
          phase.progressingInData.length > 0 &&
          phase.progressingInData.every((data) => data.origin === poolsPhaseId)
      ),
    [phases, poolsPhaseId]
  );
  const [silverPhaseId, setSilverPhaseId] = useState(0);

  const getPoolsSeeds = useCallback(async (): Promise<
    Map<number, Map<number, number>>
  > => {
    try {
      setGetting(true);
      const data = await fetchGql(sggApiKey, GET_POOLS_SEEDS_QUERY, {
        id: poolsPhaseId,
      });
      setError("");
      const poolIdToPoolSeedToOverallSeed = new Map<
        number,
        Map<number, number>
      >();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.phase.seeds.nodes as any[]).forEach((node) => {
        let seeds = poolIdToPoolSeedToOverallSeed.get(node.phaseGroup.id);
        if (!seeds) {
          seeds = new Map<number, number>();
          poolIdToPoolSeedToOverallSeed.set(node.phaseGroup.id, seeds);
        }
        seeds.set(node.groupSeedNum, node.seedNum);
      });
      return poolIdToPoolSeedToOverallSeed;
    } finally {
      setGetting(false);
    }
  }, [sggApiKey, poolsPhaseId]);

  const getSilverSeeds = useCallback(
    async (
      poolIdToPoolSeedToOverallSeed: Map<number, Map<number, number>>
    ): Promise<SilverSeed[]> => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, GET_SILVER_SEEDS_QUERY, {
          id: silverPhaseId,
        });
        setError("");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (data.phase.seeds.nodes as any[]).map((node) => ({
          id: node.id,
          overallSeed: poolIdToPoolSeedToOverallSeed
            .get(node.progressionSource.originPhaseGroup.id)!
            .get(node.progressionSource.originPlacement)!,
        }));
      } finally {
        setGetting(false);
      }
    },
    [sggApiKey, silverPhaseId]
  );

  return (
    <Stack>
      {!sggApiKey && (
        <Typography variant="caption" style={{ marginBottom: "8px" }}>
          Get your start.gg API key by clicking “Create new token” in the
          <br />
          “Personal Access Tokens” tab of{" "}
          <Link
            href="https://start.gg/admin/profile/developer"
            target="_blank"
            rel="noreferrer"
          >
            this page
          </Link>
          . Keep it private!
        </Typography>
      )}
      <TextField
        label="start.gg API key"
        size="small"
        type="password"
        variant="outlined"
        value={sggApiKey}
        onChange={(ev) => {
          setSggApiKey(ev.target.value);
        }}
      />
      {error.length > 0 && <Alert severity="error">{error}</Alert>}
      {sggApiKey && (
        <>
          {!slug && (
            <>
              <form
                style={{
                  alignItems: "center",
                  display: "flex",
                  margin: "8px 4px",
                  gap: "8px",
                }}
                onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                  const target = event.target as typeof event.target & {
                    slug: { value: string };
                  };
                  const newSlug = target.slug.value;
                  event.preventDefault();
                  event.stopPropagation();
                  if (newSlug) {
                    await getTournament(newSlug);
                  }
                }}
              >
                <TextField
                  autoFocus
                  label="Tournament Slug"
                  name="slug"
                  placeholder="super-smash-con-2023"
                  size="small"
                  variant="outlined"
                />
                <Button
                  disabled={getting}
                  endIcon={getting && <CircularProgress size="24px" />}
                  type="submit"
                  variant="contained"
                >
                  Get!
                </Button>
              </form>
              {tournaments.length > 0 && (
                <List disablePadding>
                  {tournaments.map((tournament) => (
                    <ListItemButton
                      key={tournament.slug}
                      disabled={getting}
                      onClick={async () => {
                        await getTournament(tournament.slug);
                      }}
                    >
                      <ListItemText
                        style={{ overflowX: "hidden", whiteSpace: "nowrap" }}
                      >
                        {tournament.name}{" "}
                        <Typography variant="caption">
                          ({tournament.slug})
                        </Typography>
                      </ListItemText>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </>
          )}
          {slug && !eventId && (
            <>
              {events.length > 0 && (
                <List disablePadding>
                  {events.map((event) => (
                    <ListItemButton
                      key={event.id}
                      disableGutters
                      disabled={getting}
                      onClick={async () => {
                        await getEvent(event.id);
                      }}
                    >
                      <ListItemText
                        style={{ overflowX: "hidden", whiteSpace: "nowrap" }}
                      >
                        {event.name}{" "}
                        <Typography variant="caption">({event.id})</Typography>
                      </ListItemText>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </>
          )}
          {slug && eventId > 0 && !poolsPhaseId && (
            <>
              {rrPoolsPhases.length > 0 && (
                <List disablePadding>
                  {rrPoolsPhases.map((phase) => (
                    <ListItemButton
                      key={phase.id}
                      disableGutters
                      onClick={() => {
                        setPoolsPhaseId(phase.id);
                      }}
                    >
                      <ListItemText
                        style={{ overflowX: "hidden", whiteSpace: "nowrap" }}
                      >
                        {phase.name}{" "}
                        <Typography variant="caption">({phase.id})</Typography>
                      </ListItemText>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </>
          )}
          {slug && eventId > 0 && poolsPhaseId > 0 && !silverPhaseId && (
            <>
              {sePhases.length > 0 && (
                <List disablePadding>
                  {sePhases.map((phase) => (
                    <ListItemButton
                      key={phase.id}
                      disableGutters
                      onClick={() => {
                        setSilverPhaseId(phase.id);
                      }}
                    >
                      <ListItemText
                        style={{ overflowX: "hidden", whiteSpace: "nowrap" }}
                      >
                        {phase.name}{" "}
                        <Typography variant="caption">({phase.id})</Typography>
                      </ListItemText>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </>
          )}
          {slug && eventId > 0 && poolsPhaseId > 0 && silverPhaseId > 0 && (
            <>
              <Button
                variant="contained"
                onClick={async () => {
                  const poolIdToPoolSeedToOverallSeed = await getPoolsSeeds();
                  const silverSeeds = await getSilverSeeds(
                    poolIdToPoolSeedToOverallSeed
                  );
                  console.log(silverSeeds);
                }}
              >
                Go!
              </Button>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

export default App;
