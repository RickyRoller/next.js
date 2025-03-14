import React from 'react'
import type { FlightRouterState } from '../../../server/app-render/types'
import type { CacheNode } from '../../../shared/lib/app-router-context.shared-runtime'
import { createInitialRouterState } from './create-initial-router-state'
import { PrefetchCacheEntryStatus, PrefetchKind } from './router-reducer-types'

const buildId = 'development'

const getInitialRouterStateTree = (): FlightRouterState => [
  '',
  {
    children: [
      'linking',
      {
        children: ['', {}],
      },
    ],
  },
  undefined,
  undefined,
  true,
]

describe('createInitialRouterState', () => {
  it('should return the correct initial router state', () => {
    const initialTree = getInitialRouterStateTree()
    const initialCanonicalUrl = '/linking'
    const children = (
      <html>
        <head></head>
        <body>Root layout</body>
      </html>
    )
    const initialParallelRoutes: CacheNode['parallelRoutes'] = new Map()

    const state = createInitialRouterState({
      buildId,
      initialTree,
      initialCanonicalUrl,
      initialSeedData: ['', {}, children, null, null],
      initialParallelRoutes,
      location: new URL('/linking', 'https://localhost') as any,
      initialHead: <title>Test</title>,
      couldBeIntercepted: false,
    })

    const state2 = createInitialRouterState({
      buildId,
      initialTree,
      initialCanonicalUrl,
      initialSeedData: ['', {}, children, null, null],
      initialParallelRoutes,
      location: new URL('/linking', 'https://localhost') as any,
      initialHead: <title>Test</title>,
    })

    const expectedCache: CacheNode = {
      lazyData: null,
      rsc: children,
      prefetchRsc: null,
      head: null,
      prefetchHead: null,
      lazyDataResolved: false,
      loading: null,
      error: null,
      parallelRoutes: new Map([
        [
          'children',
          new Map([
            [
              'linking',
              {
                parallelRoutes: new Map([
                  [
                    'children',
                    new Map([
                      [
                        '',
                        {
                          lazyData: null,
                          rsc: null,
                          prefetchRsc: null,
                          parallelRoutes: new Map(),
                          loading: null,
                          error: null,
                          head: <title>Test</title>,
                          prefetchHead: null,
                          lazyDataResolved: false,
                        },
                      ],
                    ]),
                  ],
                ]),
                lazyData: null,
                rsc: null,
                prefetchRsc: null,
                head: null,
                prefetchHead: null,
                lazyDataResolved: false,
                loading: null,
                error: null,
              },
            ],
          ]),
        ],
      ]),
    }

    const expected: ReturnType<typeof createInitialRouterState> = {
      buildId,
      tree: initialTree,
      canonicalUrl: initialCanonicalUrl,
      prefetchCache: new Map([
        [
          '/linking',
          {
            key: '/linking',
            data: expect.any(Promise),
            prefetchTime: expect.any(Number),
            kind: PrefetchKind.AUTO,
            lastUsedTime: expect.any(Number),
            treeAtTimeOfPrefetch: initialTree,
            status: PrefetchCacheEntryStatus.fresh,
          },
        ],
      ]),
      pushRef: {
        pendingPush: false,
        mpaNavigation: false,
        preserveCustomHistoryState: true,
      },
      focusAndScrollRef: {
        apply: false,
        onlyHashChange: false,
        hashFragment: null,
        segmentPaths: [],
      },
      cache: expectedCache,
      nextUrl: '/linking',
    }

    expect(state).toMatchObject(expected)
    expect(state2).toMatchObject(expected)
  })
})
