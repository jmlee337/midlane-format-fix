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
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ArrowBack } from "@mui/icons-material";

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
  query poolsSeeds($id: ID) {
    phase(id: $id) {
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
  query silverSeeds($id: ID) {
    phase(id: $id) {
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

function checkForRematch(
  seedsA: number[],
  seedsB: number[],
  roundOf: number,
  overallSeedToPool: Map<number, Set<number>>,
  depth: number
) {
  let anyRematchFound = false;
  let aLowerThanB = false;
  let bLowerThanA = false;
  const jLength = Math.min(seedsA.length, depth);
  for (let j = 0; j < jLength; j++) {
    const aPool = overallSeedToPool.get(seedsA[j]);
    if (aPool) {
      const kLength = Math.min(seedsB.length, depth);
      for (let k = 0; k < kLength; k++) {
        if (aPool.has(seedsB[k])) {
          if (!anyRematchFound) {
            console.log(
              `${JSON.stringify(seedsA)} vs ${JSON.stringify(seedsB)}`
            );
            anyRematchFound = true;
          }
          console.log(
            `rematch found in RO${roundOf}: ${seedsA[j]} vs ${
              seedsB[k]
            } (depth: ${j + 1}, ${k + 1})`
          );
          if (j === k) {
            return anyRematchFound;
          }
          if (j < k) {
            aLowerThanB = true;
          } else {
            bLowerThanA = true;
          }
          if (aLowerThanB && bLowerThanA) {
            return anyRematchFound;
          }
        }
      }
    }
  }
  return anyRematchFound;
}

function checkForRematches(
  silverSeeds: SilverSeed[],
  numPools: number,
  depth: number
) {
  // set up SE
  const log2 = Math.log2(silverSeeds.length);
  let part = Math.pow(2, log2 % 1 === 0 ? log2 - 1 : Math.trunc(log2));
  const seeds: number[][] = [];
  for (let i = 0; i < part * 2; i++) {
    const silverSeed = silverSeeds[i];
    seeds.push(silverSeed ? [silverSeed.overallSeed] : []);
  }

  // derive pools
  const maxRealOverallSeed = Math.max(
    ...silverSeeds.map((silverSeed) => silverSeed.overallSeed)
  );
  const maxOverallSeed =
    maxRealOverallSeed % numPools === 0
      ? maxRealOverallSeed
      : (Math.trunc(maxRealOverallSeed / numPools) + 1) * numPools;
  const allOverallSeeds = Array.from(
    { length: maxOverallSeed },
    (_, i) => i + 1
  );
  const overallSeedToPool = new Map<number, Set<number>>();
  const pools = Array.from({ length: numPools }, () => new Set<number>());
  let reverse = false;
  while (allOverallSeeds.length > 0) {
    const theseSeeds = allOverallSeeds.slice(0, numPools);
    if (reverse) {
      theseSeeds.reverse();
    }
    for (let i = 0; i < numPools; i++) {
      const overallSeed = theseSeeds[i];
      pools[i].add(overallSeed);
      overallSeedToPool.set(overallSeed, pools[i]);
    }

    allOverallSeeds.splice(0, numPools);
    reverse = !reverse;
  }

  let anyRematchFound = false;
  while (part >= 1) {
    const sideA = seeds.slice(0, part);
    const sideB = seeds.slice(part);
    sideB.reverse();
    for (let i = 0; i < part; i++) {
      if (
        checkForRematch(sideA[i], sideB[i], part * 2, overallSeedToPool, depth)
      ) {
        anyRematchFound = true;
      }
    }

    seeds.length = 0;
    for (let i = 0; i < part; i++) {
      seeds.push(sideA[i].concat(sideB[i]).sort());
    }
    part /= 2;
  }
  if (!anyRematchFound) {
    console.log(`no rematches found up to depth: ${depth}`);
  }
}

function App() {
  const [error, setError] = useState("");
  const [sggApiKey, setSggApiKey] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  useEffect(() => {
    (async () => {
      try {
        if (sggApiKey) {
          const data = await fetchGql(
            sggApiKey,
            GET_ADMINED_TOURNAMENTS_QUERY,
            {}
          );
          setError("");
          setTournaments(data.currentUser.tournaments.nodes ?? []);
        }
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
    <Stack style={{ alignItems: "start" }}>
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
        slotProps={{
          htmlInput: {
            size: 32,
          },
        }}
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
              {tournaments.length > 0 &&
                tournaments.map((tournament) => (
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
            </>
          )}
          {slug && (
            <>
              <ListItemButton
                style={{ paddingLeft: 0 }}
                onClick={() => {
                  setSlug("");
                  setEventId(0);
                  setPoolsPhaseId(0);
                  setSilverPhaseId(0);
                }}
              >
                <ListItemIcon>
                  <ArrowBack />
                </ListItemIcon>
                <ListItemText>{slug}</ListItemText>
              </ListItemButton>
              {!eventId && (
                <>
                  {events.length > 0 && (
                    <List disablePadding>
                      {events.map((event) => (
                        <ListItemButton
                          key={event.id}
                          disabled={getting}
                          onClick={async () => {
                            await getEvent(event.id);
                          }}
                        >
                          <ListItemText
                            style={{
                              overflowX: "hidden",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {event.name}{" "}
                            <Typography variant="caption">
                              ({event.id})
                            </Typography>
                          </ListItemText>
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                </>
              )}
              {eventId > 0 && (
                <>
                  <ListItemButton
                    style={{ paddingLeft: 0 }}
                    onClick={() => {
                      setEventId(0);
                      setPoolsPhaseId(0);
                      setSilverPhaseId(0);
                    }}
                  >
                    <ListItemIcon>
                      <ArrowBack />
                    </ListItemIcon>
                    <ListItemText>Event ID: {eventId}</ListItemText>
                  </ListItemButton>
                  {!poolsPhaseId && (
                    <>
                      {rrPoolsPhases.length > 0 && (
                        <List disablePadding>
                          {rrPoolsPhases.map((phase) => (
                            <ListItemButton
                              key={phase.id}
                              onClick={() => {
                                setPoolsPhaseId(phase.id);
                              }}
                            >
                              <ListItemText
                                style={{
                                  overflowX: "hidden",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {phase.name}{" "}
                                <Typography variant="caption">
                                  ({phase.id})
                                </Typography>
                              </ListItemText>
                            </ListItemButton>
                          ))}
                        </List>
                      )}
                    </>
                  )}
                  {poolsPhaseId > 0 && (
                    <>
                      <ListItemButton
                        style={{ paddingLeft: 0 }}
                        onClick={() => {
                          setPoolsPhaseId(0);
                          setSilverPhaseId(0);
                        }}
                      >
                        <ListItemIcon>
                          <ArrowBack />
                        </ListItemIcon>
                        <ListItemText>
                          Pools Phase ID: {poolsPhaseId}
                        </ListItemText>
                      </ListItemButton>
                      {!silverPhaseId && (
                        <>
                          {sePhases.length > 0 && (
                            <List disablePadding>
                              {sePhases.map((phase) => (
                                <ListItemButton
                                  key={phase.id}
                                  onClick={() => {
                                    setSilverPhaseId(phase.id);
                                  }}
                                >
                                  <ListItemText
                                    style={{
                                      overflowX: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {phase.name}{" "}
                                    <Typography variant="caption">
                                      ({phase.id})
                                    </Typography>
                                  </ListItemText>
                                </ListItemButton>
                              ))}
                            </List>
                          )}
                        </>
                      )}
                      {silverPhaseId > 0 && (
                        <>
                          <ListItemButton
                            style={{ paddingLeft: 0 }}
                            onClick={() => {
                              setSilverPhaseId(0);
                            }}
                          >
                            <ListItemIcon>
                              <ArrowBack />
                            </ListItemIcon>
                            <ListItemText>
                              Silver Phase ID: {silverPhaseId}
                            </ListItemText>
                          </ListItemButton>
                          <Stack
                            direction="row"
                            style={{ alignItems: "center", height: "48px" }}
                          >
                            <Button
                              color="warning"
                              variant="outlined"
                              onClick={async () => {
                                const poolIdToPoolSeedToOverallSeed =
                                  await getPoolsSeeds();
                                const silverSeeds = (
                                  await getSilverSeeds(
                                    poolIdToPoolSeedToOverallSeed
                                  )
                                ).sort((a, b) => a.overallSeed - b.overallSeed);
                                const numPools =
                                  poolIdToPoolSeedToOverallSeed.size;

                                let rotate = 0;
                                const proposedSilverSeeds: SilverSeed[] = [];
                                while (silverSeeds.length > 0) {
                                  let nextSeeds = silverSeeds.slice(
                                    0,
                                    numPools
                                  );
                                  if (rotate > 0) {
                                    const end = nextSeeds.splice(-rotate);
                                    nextSeeds = end.concat(nextSeeds);
                                  }
                                  proposedSilverSeeds.push(...nextSeeds);

                                  silverSeeds.splice(0, numPools);
                                  rotate += 2;
                                  if (rotate >= numPools) {
                                    rotate = rotate % numPools;
                                  }
                                }

                                console.log("proposed seeding:");
                                for (
                                  let i = 0;
                                  i < proposedSilverSeeds.length;
                                  i += numPools
                                ) {
                                  console.log(
                                    JSON.stringify(
                                      proposedSilverSeeds
                                        .slice(i, i + numPools)
                                        .map(
                                          (silverSeed) => silverSeed.overallSeed
                                        )
                                    )
                                  );
                                }
                                console.log("\n");
                                checkForRematches(
                                  proposedSilverSeeds,
                                  numPools,
                                  4
                                );
                              }}
                            >
                              Check (See console)
                            </Button>
                          </Stack>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Stack>
  );
}

export default App;
