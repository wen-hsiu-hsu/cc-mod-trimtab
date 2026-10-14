"""Shots of the subagent-dispatch stats pane, over made-up ledgers.

Read by scripts/capture-pane.py. `OPEN` opens the pane, `store(now)` is the mod's $.store before the session starts;
`SHOTS` names each image under docs/images/subagent-dispatch/ and the keys that lead to it.
"""
import random
from datetime import timedelta

PLUGIN = 'subagent-dispatch'
# The command that opens the pane.
OPEN = '/subagent-dispatch stats'

# Each shot: the image name, the terminal width, the keys after the pane opens, and what it shows.
# A step is `keys:<text>` or `wait:<seconds>`, as in capture-pane.py.
SHOTS = [
    {'name': 'stats-80', 'cols': 80, 'steps': [], 'about': 'The pane at 80 columns: the last 30 days by repo'},
    {'name': 'stats-row-80', 'cols': 80, 'steps': ['keys:\t'] * 6 + ['keys:\r'], 'about': 'The first row opened'},
]

REPOS = ['/home/dev/web-app', '/home/dev/api-server', '/home/dev/docs-site', '/home/dev/infra']
MODELS = {'main': 'claude-opus-5-5', 'sonnet': 'claude-sonnet-5-5', 'haiku': 'claude-haiku-5-5'}
SPAWNS = [
    ('Explore', 'haiku', 'Find where the session token is refreshed'),
    ('Explore', 'haiku', 'Locate the retry logic for webhooks'),
    ('reviewer', 'sonnet', 'Review the diff for the billing change'),
    ('reviewer', 'sonnet', 'Check the docs against the CLI flags'),
    ('implementer', 'sonnet', 'Add pagination to the audit log API'),
    ('general-purpose', None, 'Summarize the failing CI runs'),
    ('checker', 'haiku', 'Confirm each TODO entry is self-contained'),
]
ZEROS = {'all': 0, 'explicit': 0, 'opus': 0, 'forks': 0, 'defaults': 0}
# Ledgers for the last LEDGER_DAYS days; day rows alone before that, back to HEAT_DAYS.
LEDGER_DAYS = 85
HEAT_DAYS = 330


def ms(moment):
    return int(moment.timestamp() * 1000)


def tally(rand, scale, steps):
    return {
        'input': int(rand.uniform(0.6, 1.4) * 40_000 * scale),
        'cacheWrite': int(rand.uniform(0.6, 1.4) * 90_000 * scale),
        'cacheRead': int(rand.uniform(0.6, 1.4) * 2_400_000 * scale),
        'output': int(rand.uniform(0.6, 1.4) * 30_000 * scale),
        'steps': steps,
    }


def busy(rand, day):
    """How much a day is used: less at weekends, nothing on some days."""
    if rand.random() < (0.55 if day.weekday() >= 5 else 0.08):
        return 0.0

    return rand.uniform(0.3, 1.6) * (0.4 if day.weekday() >= 5 else 1.0)


def quiet(day):
    moment = ms(day + timedelta(hours=10))

    return {'updated': moment, 'repo': REPOS[0], 'started': moment, 'prompt': 'Made-up session for the docs', 'daily': {}, 'spawns': []}


def store(now):
    rand = random.Random(7)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    data = {'backfill': {'state': 'done', 'at': ms(now), 'sessions': 0, 'skipped': 0}}
    for back in range(LEDGER_DAYS - 1, -1, -1):
        day = today - timedelta(days=back)
        scale = busy(rand, day)
        if scale == 0:
            # A session that day that used nothing, or none at all.
            if rand.random() < 0.6:
                data[f'ledger:{rand.randrange(16**12):012x}'] = quiet(day)
            continue
        for index in range(rand.randint(1, 3)):
            start = day + timedelta(hours=9 + index * 3, minutes=rand.randint(0, 50))
            # Today's sessions end before the capture runs.
            end = min(start + timedelta(minutes=rand.randint(30, 150)), now - timedelta(minutes=5))
            if end <= start:
                continue
            spawns = []
            for _ in range(rand.choice([0, 1, 2, 2, 3, 4])):
                kind, requested, description = rand.choice(SPAWNS)
                at = start + (end - start) * rand.uniform(0.1, 0.7)
                last = min(at + timedelta(minutes=rand.randint(1, 25)), end)
                spawn = {
                    'agentId': f'a{rand.randrange(16**8):08x}',
                    'at': ms(at),
                    'last': ms(last),
                    'description': description,
                    'type': kind,
                    'model': MODELS[requested or 'main'],
                    'fork': False,
                    'background': rand.random() < 0.3,
                    **tally(rand, scale * rand.choice([0.05, 0.15, 0.3, 0.6]), rand.randint(5, 40)),
                }
                if requested:
                    spawn['requested'] = requested
                spawns.append(spawn)
            data[f'ledger:{rand.randrange(16**12):012x}'] = {
                'updated': ms(end),
                'repo': rand.choices(REPOS, weights=[5, 3, 1, 1])[0],
                'started': ms(start),
                'prompt': 'Made-up session for the docs',
                'daily': {day.strftime('%Y-%m-%d'): {MODELS['main']: tally(rand, scale, rand.randint(20, 120))}},
                'spawns': spawns,
            }
    for back in range(LEDGER_DAYS, HEAT_DAYS):
        day = today - timedelta(days=back)
        scale = busy(rand, day)
        if scale == 0:
            if rand.random() < 0.6:
                data[f'day:{day.strftime("%Y-%m-%d")}'] = {'main': {}, 'sub': {}, 'spawned': ZEROS, 'at': ms(day + timedelta(days=2))}
            continue
        data[f'day:{day.strftime("%Y-%m-%d")}'] = {
            'main': {MODELS['main']: tally(rand, scale * 2, 150)},
            'sub': {MODELS['haiku']: tally(rand, scale * 0.5, 40)},
            'spawned': ZEROS,
            'at': ms(day + timedelta(days=2)),
        }

    return data
