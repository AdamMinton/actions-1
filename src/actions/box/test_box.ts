import * as b64 from "base64-url"
import * as chai from "chai"
import * as https from "request-promise-native"
import * as sinon from "sinon"

import { ActionCrypto } from "../../hub"
import { BoxAction } from "./box"

const action = new BoxAction()

describe(`${action.constructor.name} unit tests`, () => {
    let encryptStub: any
    let decryptStub: any

    beforeEach(() => {
        encryptStub = sinon.stub(ActionCrypto.prototype, "encrypt").callsFake(async (s: string) => b64.encode(s))
        decryptStub = sinon.stub(ActionCrypto.prototype, "decrypt").callsFake(async (s: string) => b64.decode(s))
    })

    afterEach(() => {
        encryptStub.restore()
        decryptStub.restore()
    })

    describe("oauth", () => {
        it("returns correct redirect url", () => {
            process.env.BOX_ACTION_APP_KEY = "testingkey"
            const prom = action.oauthUrl("https://actionhub.com/actions/box/oauth_redirect",
                `eyJzdGF0ZXVybCI6Imh0dHBzOi8vbG9va2VyLnN0YXRlLnVybC5jb20vYWN0aW9uX2h1Yl9zdGF0ZS9hc2RmYXNkZmFzZGZhc2RmIn0`)
            return chai.expect(prom).to.eventually.equal("https://www.box.com/oauth2/authorize?response_type=code&" +
                "client_id=testingkey&redirect_uri=https%3A%2F%2Factionhub.com%2Factions%2Fbox%2Foauth_redirect&" +
                "force_reapprove=true&" +
                "state=eyJzdGF0ZXVybCI6Imh0dHBzOi8vbG9va2VyLnN0YXRlLnVybC5jb20vYWN0aW9uX2h1Yl9zdGF0ZS9hc2RmYXNkZmFzZGZhc2RmIn0")
        })

        it("correctly handles redirect from authorization server", (done) => {
            const stubReq = sinon.stub(https, "post").callsFake(async () => Promise.resolve({ access_token: "token" }))
            const result = action.oauthFetchInfo({
                code: "code",
                state: `eyJzdGF0ZXVybCI6Imh0dHBzOi8vbG9va2VyLnN0YXRlLnVybC5jb20vYWN0aW9uX2h1Yl9zdGF0ZS9hc2RmYXNkZmFzZGZh` +
                    `c2RmIiwiYXBwIjoibXlrZXkifQ`
            },
                "redirect")
            chai.expect(result)
                .and.notify(stubReq.restore).and.notify(done)
        })
    })
})
