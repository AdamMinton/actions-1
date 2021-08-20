import * as querystring from "querystring"
import * as https from "request-promise-native"
import { URL } from "url"

import Box = require("box-node-sdk")
import * as winston from "winston"
import * as Hub from "../../hub"

export class BoxAction extends Hub.OAuthAction {
    name = "box"
    label = "Box"
    iconName = "box/box.png"
    description = "Send data directly to a Box folder."
    supportedActionTypes = [Hub.ActionType.Query, Hub.ActionType.Dashboard]
    usesStreaming = false
    minimumSupportedLookerVersion = "6.8.0"
    requiredFields = []
    params = []

    async execute(request: Hub.ActionRequest) {
        const filename = request.formParams.filename
        const directory = request.formParams.directory
        const ext = request.attachment!.fileExtension

        let accessToken = ""
        if (request.params.state_json) {
            const stateJson = JSON.parse(request.params.state_json)
            if (stateJson.code && stateJson.redirect) {
                accessToken = await this.getAccessTokenFromCode(stateJson)
            }
        }
        var box = this.boxClientFromRequest(request, accessToken)

        const resp = new Hub.ActionResponse()
        resp.success = true
        if (request.attachment && request.attachment.dataBuffer) {
            const fileBuf = request.attachment.dataBuffer
            const path = (directory === "__root") ? `/${filename}.${ext}` : `/${directory}/${filename}.${ext}`
            await box.files.fileUpload({ path: `${path}`, contents: fileBuf }).catch((err: any) => {
                winston.error(`Upload unsuccessful: ${JSON.stringify(err)}`)
                resp.success = false
                resp.state = new Hub.ActionState()
                resp.state.data = "reset"
            })
        } else {
            resp.success = false
            resp.message = "No data sent from Looker to be sent to Box."
        }
        return resp
    }

    async form(request: Hub.ActionRequest) {
        const form = new Hub.ActionForm()
        form.fields = []

        let accessToken = ""
        if (request.params.state_json) {
            try {
                const stateJson = JSON.parse(request.params.state_json)
                if (stateJson.code && stateJson.redirect) {
                    accessToken = await this.getAccessTokenFromCode(stateJson)
                }
            } catch { winston.warn("Could not parse state_json") }
        }
        const box = this.boxClientFromRequest(request, accessToken)
        try {
            const response = await box.folders.getItems({ path: "" })
            const folderList = response.entries.filter((entries: any) => (entries[".tag"] === "folder"))
                .map((entries: any) => ({ name: entries.name, label: entries.name }))
            folderList.unshift({ name: "__root", label: "Home" })
            form.fields = [{
                description: "Box folder where your file will be saved",
                label: "Select folder to save file",
                name: "directory",
                options: folderList,
                required: true,
                type: "select",
                default: "__root",
            }, {
                label: "Enter a name",
                name: "filename",
                type: "string",
                required: true,
            }]
            if (accessToken !== "") {
                const newState = JSON.stringify({ access_token: accessToken })
                form.state = new Hub.ActionState()
                form.state.data = newState
            }
            return form
        } catch (_error) {
            const actionCrypto = new Hub.ActionCrypto()
            const jsonString = JSON.stringify({ stateurl: request.params.state_url })
            const ciphertextBlob = await actionCrypto.encrypt(jsonString).catch((err: string) => {
                winston.error("Encryption not correctly configured")
                throw err
            })
            form.state = new Hub.ActionState()
            form.fields.push({
                name: "login",
                type: "oauth_link",
                label: "Log in",
                description: "In order to send to a Box file or folder now and in the future, you will need to log in" +
                    " once to your Box account.",
                oauth_url: `${process.env.ACTION_HUB_BASE_URL}/actions/box/oauth?state=${ciphertextBlob}`,
            })
            return (form)
        }
    }

    async oauthUrl(redirectUri: string, encryptedState: string) {
        const url = new URL("https://www.box.com/oauth2/authorize")
        url.search = querystring.stringify({
            response_type: "code",
            client_id: process.env.BOX_ACTION_APP_KEY,
            redirect_uri: redirectUri,
            force_reapprove: true,
            state: encryptedState,
        })
        return url.toString()
    }

    async oauthFetchInfo(urlParams: { [key: string]: string }, redirectUri: string) {
        const actionCrypto = new Hub.ActionCrypto()
        const plaintext = await actionCrypto.decrypt(urlParams.state).catch((err: string) => {
            winston.error("Encryption not correctly configured" + err)
            throw err
        })

        const payload = JSON.parse(plaintext)
        await https.post({
            url: payload.stateurl,
            body: JSON.stringify({ code: urlParams.code, redirect: redirectUri }),
        }).catch((_err) => { winston.error(_err.toString()) })
    }

    async oauthCheck(request: Hub.ActionRequest) {
        const box = this.boxClientFromRequest(request, "")
        try {
            await box.folders.getItems({ path: "" })
            return true
        } catch (err) {
            //winston.error((err as BoxTypes.Error<BoxTypes.files.ListFolderError>).error.toString())
            return false
        }
    }

    protected async getAccessTokenFromCode(stateJson: any) {
        const url = new URL("https://account.box.com/api/oauth2/token")

        if (stateJson.code && stateJson.redirect) {
            url.search = querystring.stringify({
                grant_type: "authorization_code",
                code: stateJson.code,
                client_id: process.env.BOX_ACTION_APP_KEY,
                client_secret: process.env.BOX_ACTION_APP_SECRET,
                redirect_uri: stateJson.redirect,
            })
        } else {
            throw "state_json does not contain correct members"
        }
        const response = await https.post(url.toString(), { json: true })
            .catch((_err) => { winston.error("Error requesting access_token") })
        return response.access_token
    }

    protected boxClientFromRequest(request: Hub.ActionRequest, token: string) {
        if (request.params.state_json && token === "") {
            try {
                const json = JSON.parse(request.params.state_json)
                token = json.access_token
            } catch (er) {
                winston.error("cannot parse")
            }
        }

        var sdk = new Box({ accessToken: token })
        var adminAPIClient = sdk.getPersistentClient(token)
        return adminAPIClient
    }
}

if (process.env.BOX_ACTION_APP_KEY && process.env.BOX_ACTION_APP_SECRET) {
    Hub.addAction(new BoxAction())
}
