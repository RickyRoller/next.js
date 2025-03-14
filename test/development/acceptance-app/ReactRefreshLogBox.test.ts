/* eslint-env jest */
import { sandbox } from 'development-sandbox'
import { FileRef, nextTestSetup } from 'e2e-utils'
import {
  check,
  describeVariants as describe,
  expandCallStack,
} from 'next-test-utils'
import path from 'path'
import { outdent } from 'outdent'

const IS_TURBOPACK = Boolean(process.env.TURBOPACK)

describe.each(['default', 'turbo'])('ReactRefreshLogBox app %s', () => {
  const { next } = nextTestSetup({
    files: new FileRef(path.join(__dirname, 'fixtures', 'default-template')),
    dependencies: {
      react: 'latest',
      'react-dom': 'latest',
    },
    skipStart: true,
  })

  test('should strip whitespace correctly with newline', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.patch(
      'index.js',
      outdent`
        export default function Page() {
          return (
            <>
              <p>index page</p>

              <a onClick={() => {
                throw new Error('idk')
              }}>
                click me
              </a>
            </>
          )
        }
      `
    )
    await session.evaluate(() => document.querySelector('a').click())

    await session.waitForAndOpenRuntimeError()
    expect(await session.getRedboxSource()).toMatchSnapshot()

    await cleanup()
  })

  // https://github.com/pmmmwh/react-refresh-webpack-plugin/pull/3#issuecomment-554137807
  test('module init error not shown', async () => {
    // Start here:
    const { session, cleanup } = await sandbox(next)

    // We start here.
    await session.patch(
      'index.js',
      outdent`
        import * as React from 'react';
        class ClassDefault extends React.Component {
          render() {
            return <h1>Default Export</h1>;
          }
        }
        export default ClassDefault;
      `
    )

    expect(
      await session.evaluate(() => document.querySelector('h1').textContent)
    ).toBe('Default Export')

    // Add a throw in module init phase:
    await session.patch(
      'index.js',
      outdent`
        // top offset for snapshot
        import * as React from 'react';
        throw new Error('no')
        class ClassDefault extends React.Component {
          render() {
            return <h1>Default Export</h1>;
          }
        }
        export default ClassDefault;
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    if (process.platform === 'win32') {
      expect(await session.getRedboxSource()).toMatchSnapshot()
    } else {
      expect(await session.getRedboxSource()).toMatchSnapshot()
    }

    await cleanup()
  })

  // https://github.com/pmmmwh/react-refresh-webpack-plugin/pull/3#issuecomment-554152127
  test('boundaries', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.write(
      'FunctionDefault.js',
      outdent`
        export default function FunctionDefault() {
          return <h2>hello</h2>
        }
      `
    )
    await session.patch(
      'index.js',
      outdent`
        import FunctionDefault from './FunctionDefault.js'
        import * as React from 'react'
        class ErrorBoundary extends React.Component {
          constructor() {
            super()
            this.state = { hasError: false, error: null };
          }
          static getDerivedStateFromError(error) {
            return {
              hasError: true,
              error
            };
          }
          render() {
            if (this.state.hasError) {
              return this.props.fallback;
            }
            return this.props.children;
          }
        }
        function App() {
          return (
            <ErrorBoundary fallback={<h2>error</h2>}>
              <FunctionDefault />
            </ErrorBoundary>
          );
        }
        export default App;
      `
    )

    expect(
      await session.evaluate(() => document.querySelector('h2').textContent)
    ).toBe('hello')

    await session.write(
      'FunctionDefault.js',
      `export default function FunctionDefault() { throw new Error('no'); }`
    )

    await session.waitForAndOpenRuntimeError()
    expect(await session.getRedboxSource()).toMatchSnapshot()
    expect(
      await session.evaluate(() => document.querySelector('h2').textContent)
    ).toBe('error')

    await cleanup()
  })

  // TODO: investigate why this fails when running outside of the Next.js
  // monorepo e.g. fails when using pnpm create next-app
  // https://github.com/vercel/next.js/pull/23203
  test.skip('internal package errors', async () => {
    const { session, cleanup } = await sandbox(next)

    // Make a react build-time error.
    await session.patch(
      'index.js',
      outdent`
        export default function FunctionNamed() {
          return <div>{{}}</div>
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    // We internally only check the script path, not including the line number
    // and error message because the error comes from an external library.
    // This test ensures that the errored script path is correctly resolved.
    expect(await session.getRedboxSource()).toContain(
      `../../../../packages/next/dist/pages/_document.js`
    )

    await cleanup()
  })

  test('unterminated JSX', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.patch(
      'index.js',
      outdent`
        export default () => {
          return (
            <div>
              <p>lol</p>
            </div>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(false)

    await session.patch(
      'index.js',
      outdent`
        export default () => {
          return (
            <div>
              <p>lol</p>
            div
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)

    const source = next.normalizeTestDirContent(await session.getRedboxSource())
    if (IS_TURBOPACK) {
      expect(source).toMatchInlineSnapshot(`
        "./index.js:7:1
        Parsing ecmascript source code failed
          5 |     div
          6 |   )
        > 7 | }
            | ^

        Unexpected token. Did you mean \`{'}'}\` or \`&rbrace;\`?"
      `)
    } else {
      expect(source).toMatchInlineSnapshot(`
        "./index.js
        Error: 
          x Unexpected token. Did you mean \`{'}'}\` or \`&rbrace;\`?
           ,-[TEST_DIR/index.js:4:1]
         4 |       <p>lol</p>
         5 |     div
         6 |   )
         7 | }
           : ^
           \`----

          x Unexpected eof
           ,-[TEST_DIR/index.js:4:1]
         4 |       <p>lol</p>
         5 |     div
         6 |   )
         7 | }
           \`----

        Caused by:
            Syntax Error

        Import trace for requested module:
        ./index.js
        ./app/page.js"
      `)
    }

    await cleanup()
  })

  // Module trace is only available with webpack 5
  test('conversion to class component (1)', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.write(
      'Child.js',
      outdent`
        export default function ClickCount() {
          return <p>hello</p>
        }
      `
    )

    await session.patch(
      'index.js',
      outdent`
        import Child from './Child';

        export default function Home() {
          return (
            <div>
              <Child />
            </div>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(false)
    expect(
      await session.evaluate(() => document.querySelector('p').textContent)
    ).toBe('hello')

    await session.patch(
      'Child.js',
      outdent`
        import { Component } from 'react';
        export default class ClickCount extends Component {
          render() {
            throw new Error()
          }
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxSource()).toMatchSnapshot()

    await session.patch(
      'Child.js',
      outdent`
        import { Component } from 'react';
        export default class ClickCount extends Component {
          render() {
            return <p>hello new</p>
          }
        }
      `
    )

    expect(await session.hasRedbox()).toBe(false)
    expect(
      await session.evaluate(() => document.querySelector('p').textContent)
    ).toBe('hello new')

    await cleanup()
  })

  test('css syntax errors', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.write('index.module.css', `.button {}`)
    await session.patch(
      'index.js',
      outdent`
        import './index.module.css';
        export default () => {
          return (
            <div>
              <p>lol</p>
            </div>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(false)

    // Syntax error
    await session.patch('index.module.css', `.button`)
    expect(await session.hasRedbox()).toBe(true)
    const source = await session.getRedboxSource()
    expect(source).toMatch(
      IS_TURBOPACK ? './index.module.css:1:9' : './index.module.css:1:1'
    )
    if (!IS_TURBOPACK) {
      expect(source).toMatch('Syntax error: ')
      expect(source).toMatch('Unknown word')
    }
    expect(source).toMatch('> 1 | .button')
    expect(source).toMatch(IS_TURBOPACK ? '    |         ^' : '    | ^')

    // Checks for selectors that can't be prefixed.
    // Selector "button" is not pure (pure selectors must contain at least one local class or id)
    await session.patch('index.module.css', `button {}`)
    expect(await session.hasRedbox()).toBe(true)
    const source2 = await session.getRedboxSource()
    expect(source2).toMatchSnapshot()

    await cleanup()
  })

  test('logbox: anchors links in error messages', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.patch(
      'index.js',
      outdent`
        import { useCallback } from 'react'

        export default function Index() {
          const boom = useCallback(() => {
            throw new Error('end https://nextjs.org')
          }, [])
          return (
            <main>
              <button onClick={boom}>Boom!</button>
            </main>
          )
        }
      `
    )

    await session.evaluate(() => document.querySelector('button').click())
    await session.waitForAndOpenRuntimeError()

    const header = await session.getRedboxDescription()
    expect(header).toMatchSnapshot()
    expect(
      await session.evaluate(
        () =>
          document
            .querySelector('body > nextjs-portal')
            .shadowRoot.querySelectorAll('#nextjs__container_errors_desc a')
            .length
      )
    ).toBe(1)
    expect(
      await session.evaluate(
        () =>
          (
            document
              .querySelector('body > nextjs-portal')
              .shadowRoot.querySelector(
                '#nextjs__container_errors_desc a:nth-of-type(1)'
              ) as any
          ).href
      )
    ).toMatchSnapshot()

    await session.patch(
      'index.js',
      outdent`
        import { useCallback } from 'react'

        export default function Index() {
          const boom = useCallback(() => {
            throw new Error('https://nextjs.org start')
          }, [])
          return (
            <main>
              <button onClick={boom}>Boom!</button>
            </main>
          )
        }
      `
    )

    await session.evaluate(() => document.querySelector('button').click())
    await session.waitForAndOpenRuntimeError()

    const header2 = await session.getRedboxDescription()
    expect(header2).toMatchSnapshot()
    expect(
      await session.evaluate(
        () =>
          document
            .querySelector('body > nextjs-portal')
            .shadowRoot.querySelectorAll('#nextjs__container_errors_desc a')
            .length
      )
    ).toBe(1)
    expect(
      await session.evaluate(
        () =>
          (
            document
              .querySelector('body > nextjs-portal')
              .shadowRoot.querySelector(
                '#nextjs__container_errors_desc a:nth-of-type(1)'
              ) as any
          ).href
      )
    ).toMatchSnapshot()

    await session.patch(
      'index.js',
      outdent`
        import { useCallback } from 'react'

        export default function Index() {
          const boom = useCallback(() => {
            throw new Error('middle https://nextjs.org end')
          }, [])
          return (
            <main>
              <button onClick={boom}>Boom!</button>
            </main>
          )
        }
      `
    )

    await session.evaluate(() => document.querySelector('button').click())
    await session.waitForAndOpenRuntimeError()

    const header3 = await session.getRedboxDescription()
    expect(header3).toMatchSnapshot()
    expect(
      await session.evaluate(
        () =>
          document
            .querySelector('body > nextjs-portal')
            .shadowRoot.querySelectorAll('#nextjs__container_errors_desc a')
            .length
      )
    ).toBe(1)
    expect(
      await session.evaluate(
        () =>
          (
            document
              .querySelector('body > nextjs-portal')
              .shadowRoot.querySelector(
                '#nextjs__container_errors_desc a:nth-of-type(1)'
              ) as any
          ).href
      )
    ).toMatchSnapshot()

    await session.patch(
      'index.js',
      outdent`
        import { useCallback } from 'react'

        export default function Index() {
          const boom = useCallback(() => {
            throw new Error('multiple https://nextjs.org links http://example.com')
          }, [])
          return (
            <main>
              <button onClick={boom}>Boom!</button>
            </main>
          )
        }
      `
    )

    await session.evaluate(() => document.querySelector('button').click())
    await session.waitForAndOpenRuntimeError()

    const header4 = await session.getRedboxDescription()
    expect(header4).toMatchInlineSnapshot(
      `"Error: multiple https://nextjs.org links http://example.com"`
    )
    // Do not highlight example.com but do highlight nextjs.org
    expect(
      await session.evaluate(
        () =>
          document
            .querySelector('body > nextjs-portal')
            .shadowRoot.querySelectorAll('#nextjs__container_errors_desc a')
            .length
      )
    ).toBe(1)
    expect(
      await session.evaluate(
        () =>
          (
            document
              .querySelector('body > nextjs-portal')
              .shadowRoot.querySelector(
                '#nextjs__container_errors_desc a:nth-of-type(1)'
              ) as any
          ).href
      )
    ).toMatchSnapshot()
    expect(
      await session.evaluate(
        () =>
          (
            document
              .querySelector('body > nextjs-portal')
              .shadowRoot.querySelector(
                '#nextjs__container_errors_desc a:nth-of-type(2)'
              ) as any
          ).href
      )
    ).toBe(null)

    await cleanup()
  })

  // TODO-APP: Catch errors that happen before useEffect
  test.skip('non-Error errors are handled properly', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.patch(
      'index.js',
      outdent`
        export default () => {
          throw {'a': 1, 'b': 'x'};
          return (
            <div>hello</div>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(
      `"Error: {"a":1,"b":"x"}"`
    )

    // fix previous error
    await session.patch(
      'index.js',
      outdent`
        export default () => {
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(false)
    await session.patch(
      'index.js',
      outdent`
        class Hello {}

        export default () => {
          throw Hello
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxDescription()).toContain(
      `Error: class Hello {`
    )

    // fix previous error
    await session.patch(
      'index.js',
      outdent`
        export default () => {
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(false)
    await session.patch(
      'index.js',
      outdent`
        export default () => {
          throw "string error"
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxDescription()).toMatchInlineSnapshot(
      `"Error: string error"`
    )

    // fix previous error
    await session.patch(
      'index.js',
      outdent`
        export default () => {
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(false)
    await session.patch(
      'index.js',
      outdent`
        export default () => {
          throw null
          return (
            <div>hello</div>
          )
        }
      `
    )
    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxDescription()).toContain(
      `Error: A null error was thrown`
    )

    await cleanup()
  })

  test('Should not show __webpack_exports__ when exporting anonymous arrow function', async () => {
    const { session, cleanup } = await sandbox(next)

    await session.patch(
      'index.js',
      outdent`
        export default () => {
          if (typeof window !== 'undefined') {
            throw new Error('test')
          }

          return null
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxSource()).toMatchSnapshot()

    await cleanup()
  })

  test('Unhandled errors and rejections opens up in the minimized state', async () => {
    const { session, browser, cleanup } = await sandbox(next)

    const file = outdent`
      export default function Index() {
        //
        setTimeout(() => {
          throw new Error('Unhandled error')
        }, 0)
        setTimeout(() => {
          Promise.reject(new Error('Undhandled rejection'))
        }, 0)
        return (
          <>
            <button
              id="unhandled-error"
              onClick={() => {
                throw new Error('Unhandled error')
              }}
            >
              Unhandled error
            </button>
            <button
              id="unhandled-rejection"
              onClick={() => {
                Promise.reject(new Error('Undhandled rejection'))
              }}
            >
              Unhandled rejection
            </button>
          </>
        )
      }
    `

    await session.patch('index.js', file)

    // Unhandled error and rejection in setTimeout
    expect(
      await browser.waitForElementByCss('.nextjs-toast-errors').text()
    ).toBe('2 errors')

    // Unhandled error in event handler
    await browser.elementById('unhandled-error').click()
    await check(
      () => browser.elementByCss('.nextjs-toast-errors').text(),
      /3 errors/
    )

    // Unhandled rejection in event handler
    await browser.elementById('unhandled-rejection').click()
    await check(
      () => browser.elementByCss('.nextjs-toast-errors').text(),
      /4 errors/
    )
    expect(await session.hasRedbox()).toBe(false)

    // Add Component error
    await session.patch(
      'index.js',
      file.replace(
        '//',
        "if (typeof window !== 'undefined') throw new Error('Component error')"
      )
    )

    // Render error should "win" and show up in fullscreen
    expect(await session.hasRedbox()).toBe(true)

    await cleanup()
  })

  test.each([
    [
      'client',
      new Map([
        [
          'app/page.js',
          outdent`
        'use client'
        export default function Page() {
          if (typeof window !== 'undefined') {
            throw new Error('Client error')
          }
          return null
        }
      `,
        ],
      ]),
    ],
    [
      'server',
      new Map([
        [
          'app/page.js',
          outdent`
        export default function Page() {
          throw new Error('Server error')
        }
      `,
        ],
      ]),
    ],
  ])('Call stack count is correct for %s error', async (_, fixture) => {
    const { session, browser, cleanup } = await sandbox(next, fixture)

    expect(await session.hasRedbox()).toBe(true)

    await expandCallStack(browser)

    // Expect more than the default amount of frames
    // The default stackTraceLimit results in max 9 [data-nextjs-call-stack-frame] elements
    const callStackFrames = await browser.elementsByCss(
      '[data-nextjs-call-stack-frame]'
    )

    expect(callStackFrames.length).toBeGreaterThan(9)

    const moduleGroup = await browser.elementsByCss(
      '[data-nextjs-collapsed-call-stack-details]'
    )
    // Expect some of the call stack frames to be grouped (by React or Next.js)
    expect(moduleGroup.length).toBeGreaterThan(0)

    await cleanup()
  })

  test('should hide unrelated frames in stack trace with unknown anonymous calls', async () => {
    const { session, browser, cleanup } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          // TODO: repro stringify (<anonymous>)
          outdent`
        export default function Page() {
          const e = new Error("Boom!");
          e.stack += \`
          at stringify (<anonymous>)
          at <unknown> (<anonymous>)
          at foo (bar:1:1)\`;
          throw e;
        }
      `,
        ],
      ])
    )
    expect(await session.hasRedbox()).toBe(true)
    await expandCallStack(browser)
    let callStackFrames = await browser.elementsByCss(
      '[data-nextjs-call-stack-frame]'
    )
    let texts = await Promise.all(callStackFrames.map((f) => f.innerText()))
    expect(texts).not.toContain('stringify\n<anonymous>')
    expect(texts).not.toContain('<unknown>\n<anonymous>')
    expect(texts).toContain('foo\nbar (1:1)')

    await cleanup()
  })

  test('should hide unrelated frames in stack trace with node:internal calls', async () => {
    const { session, browser, cleanup } = await sandbox(
      next,
      new Map([
        [
          'app/page.js',
          // Node.js will throw an error about the invalid URL since this is a server component
          outdent`
          export default function Page() {
            new URL("/", "invalid");
          }`,
        ],
      ])
    )

    expect(await session.hasRedbox()).toBe(true)
    await expandCallStack(browser)

    // Should still show the errored line in source code
    const source = await session.getRedboxSource()
    expect(source).toContain('app/page.js')
    expect(source).toContain(`new URL("/", "invalid")`)

    await expandCallStack(browser)
    const callStackFrames = await browser.elementsByCss(
      '[data-nextjs-call-stack-frame]'
    )
    const texts = await Promise.all(callStackFrames.map((f) => f.innerText()))

    expect(texts.filter((t) => t.includes('node:internal'))).toHaveLength(0)

    await cleanup()
  })

  test('Server component errors should open up in fullscreen', async () => {
    const { session, browser, cleanup } = await sandbox(
      next,
      new Map([
        // Start with error
        [
          'app/page.js',
          outdent`
            export default function Page() {
              throw new Error('Server component error')
              return <p id="text">Hello world</p>
            }
          `,
        ],
      ])
    )
    expect(await session.hasRedbox()).toBe(true)

    // Remove error
    await session.patch(
      'app/page.js',
      outdent`
        export default function Page() {
          return <p id="text">Hello world</p>
        }
      `
    )
    expect(await browser.waitForElementByCss('#text').text()).toBe(
      'Hello world'
    )
    expect(await session.hasRedbox()).toBe(false)

    // Re-add error
    await session.patch(
      'app/page.js',
      outdent`
        export default function Page() {
          throw new Error('Server component error!')
          return <p id="text">Hello world</p>
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)

    await cleanup()
  })

  test('Import trace when module not found in layout', async () => {
    const { session, cleanup } = await sandbox(
      next,

      new Map([['app/module.js', `import "non-existing-module"`]])
    )

    await session.patch(
      'app/layout.js',
      outdent`
        import "./module"

        export default function RootLayout({ children }) {
          return (
            <html>
              <head></head>
              <body>{children}</body>
            </html>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxSource()).toMatchSnapshot()

    await cleanup()
  })

  test("Can't resolve @import in CSS file", async () => {
    const { session, cleanup } = await sandbox(
      next,
      new Map([
        ['app/styles1.css', '@import "./styles2.css"'],
        ['app/styles2.css', '@import "./boom.css"'],
      ])
    )

    await session.patch(
      'app/layout.js',
      outdent`
        import "./styles1.css"

        export default function RootLayout({ children }) {
          return (
            <html>
              <head></head>
              <body>{children}</body>
            </html>
          )
        }
      `
    )

    expect(await session.hasRedbox()).toBe(true)
    expect(await session.getRedboxSource()).toMatchSnapshot()

    await cleanup()
  })

  // TODO: The error overlay is not closed when restoring the working code.
  for (const type of ['server' /* , 'client' */]) {
    test(`${type} component can recover from error thrown in the module`, async () => {
      const { session, cleanup } = await sandbox(next, undefined, '/' + type)

      await next.patchFile('index.js', "throw new Error('module error')")
      expect(await session.hasRedbox()).toBe(true)
      await next.patchFile(
        'index.js',
        'export default function Page() {return <p>hello world</p>}'
      )
      expect(await session.hasRedbox()).toBe(false)

      await cleanup()
    })
  }
})
