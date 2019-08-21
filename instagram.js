/**
  * @author Alex Yatsenko
  * @link https://github.com/yatsenkolesh/instagram-nodejs
*/

"use-strict";

const fetch = require('node-fetch');
const formData = require('form-data');
const request = require('request');
const qs = require('query-string');

module.exports = class Instagram {
  /**
    * Constructor
  */
  constructor(csrfToken, sessionId) {
    this.csrfToken = csrfToken
    this.sessionId = sessionId
    this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36'
    this.userIdFollowers = {};
    this.timeoutForCounter = 300
    this.timeoutForCounterValue = 30000
    this.receivePromises = {}
    this.searchTypes = ['location', 'hashtag']

    this.essentialValues = {
      sessionid   : undefined,
      ds_user_id  : undefined,
      csrftoken   : undefined,
      shbid       : undefined,
      rur         : undefined,
      mid         : undefined,
      shbts       : undefined,
      mcd         : undefined,
      ig_cb       : 1,
      fbm_124024574287414:"base_domain=.instagram.com",
      //urlgen      : undefined //this needs to be filled in according to my RE
    };

    this.baseHeader = {
      'accept-langauge': 'en-US;q=0.9,en;q=0.8,es;q=0.7',
      'origin': 'https://www.instagram.com',
      'referer': 'https://www.instagram.com/',
      'upgrade-insecure-requests': '1',
      'user-agent': this.userAgent,    
    }
  }

  
  generateCookie(simple){
    if (simple) return 'ig_cb=1'

    var cookie = ''
    var keys = Object.keys(this.essentialValues)
    for (var i = 0; i < keys.length; i++){
      var key = keys[i];
      cookie += key + '=' + this.essentialValues[key] + (i < keys.length - 1 ? '; ' : '')
    }
    return cookie;
  }

//ds_user_id=234407422; 
//mid=W2gh5wAEAAHIroU6Vaw4ot7k_tn5; 
/*mcd=3;
fbm_124024574287414=base_domain=.instagram.com;
csrftoken=xYK1W6rAEZE5skBApqbDyZKzrV4o4xDY;
datr=Vfi-W-WkJu88fBdz9BzWlo_Y;
shbid=5378;
shbts=1543993118.9626384;
csrftoken=eUl8Vxg5xRV73zzZ0q2tLkVcF8PylcA4;
rur=ATN;
sessionid=234407422%3AXg6FZiSkFVJPKo%3A8;
urlgen="{}:1gVEIz:-2iEYbqUuw1O8kNuyKIT4kUx0To"
------------------
sessionid=5564209542%3AzjiyVhKMC73euv%3A0;
ds_user_id=5564209542;
csrftoken=8WCb43Nh9KpxylQvs1PONrzS2Edpt0Dh;
shbid=11385;
rur=PRN;
mid=XApZiwAEAAEvtzPlMLf3xbHA7sBG;
shbts=1544182157.1888468;
mcd=3;
ig_cb=1
*/
  combineWithBaseHeader(data){
    return Object.assign(this.baseHeader, data)
  }

  updateEssentialValues(src, isHTML){
    //assumes that essential values will be extracted from a cookie unless specified by the isHTML bool

    if (!isHTML){
      var keys = Object.keys(this.essentialValues)

        for (var i = 0; i < keys.length; i++){
          var key = keys[i];
          if (!this.essentialValues[key])
            for (let cookie in src)
              if (src[cookie].includes(key) && !src[cookie].includes(key + '=""')){
                var cookieValue = src[cookie].split(';')[0].replace(key + '=', '')
                this.essentialValues[key] = cookieValue
                break;
              }
        }
      } else {
        var subStr = src;

        var startStr = '<script type="text/javascript">window._sharedData = ';
        var start = subStr.indexOf(startStr) + startStr.length;
        subStr = subStr.substr(start, subStr.length);
        
        subStr = subStr.substr(0, subStr.indexOf('</script>') - 1);

        var json = JSON.parse(subStr);

        this.essentialValues.csrftoken = json.config.csrf_token;
        this.rollout_hash = json.rollout_hash;
      }
  }

  /**
    * User data by username
    * @param {String} username
    * @return {Object} Promise
  */
  getUserDataByUsername(username,sessionid,ownUser,csrfToken) {

    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      // 'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}; csrftoken=${csrfToken};`,
      "x-csrftoken": csrfToken,
    }
    
    var fetch_data = {
      'method': 'get',
      headers
    }
    
    return fetch('https://www.instagram.com/' + username, fetch_data).then(res => res.text().then(function (data) {
      const regex = /window\._sharedData = (.*);<\/script>/;
      const match = regex.exec(data);
      if (typeof match[1] === 'undefined') {
        return '';
      }
      return JSON.parse(match[1]).entry_data.ProfilePage[0];
    }))
  }

  /**
    Is private check
    * @param {String} usernmae
  */
  isPrivate(username) {
    return this.getUserDataByUsername(username).then((data) =>
      data.user.is_private
    )
  }

  /**
    * User followers list
    * Bench - 1k followers/1 min
    * @param {Int} userId
    * @param {String} command
    * @param {String} Params
    * @param {Int} followersCounter counter of followers
    * @param {Boolean} selfSelf if call by self
    * @return {Object} array followers list
  */
  getUserFollowers(userId, command, params, followersCounter, selfSelf, sessionid, ownUser) {
    const self = this
    if (!selfSelf)
      self.userIdFollowers[userId] = []

    if (typeof self.receivePromises[userId] !== 'undefined' && !selfSelf)
      return 0

    command = !command ? 'first' : command
    params = !params ? 20 : params

    let queryString = 'followed_by.' + command + '(' + params + ') {';

    let postBody = 'ig_user(' + userId + ') {' + queryString + 'count,\
          page_info {\
            end_cursor,\
            has_next_page\
          },\
          nodes {\
            id,\
            is_verified,\
            followed_by_viewer,\
            requested_by_viewer,\
            full_name,\
            profile_pic_url,\
            username\
          }\
        }\
      }'

    let form = new formData();
    form.append('q', postBody)

    self.receivePromises[userId] = 1
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}`
    }
    return fetch('https://www.instagram.com/query/',
      {
        'method': 'post',
        'body': form,
        'headers':headers
      }).then(res => {
        return res.text().then(function (response) {
          //prepare convert to json
          let json = response

          try {
            json = JSON.parse(response)
          }
          catch (e) {
            console.log('Error',e);
            return [];
          }

          if (json.status == 'ok') {
            self.userIdFollowers[userId] = self.userIdFollowers[userId].concat(json.followed_by.nodes)

            if (json.followed_by.page_info.has_next_page) {
              return new Promise((resolve) => {
                let after = json.followed_by.page_info.end_cursor
                resolve(self.getUserFollowers(userId, 'after', after + ',20', 1, 1))
              },
                (reject) =>
                  console.log('Error handle response from instagram server(get followers request)')
              )
            }
            else {
              self.receivePromises[userId] = undefined
              return self.userIdFollowers[userId]
            }

          }
          else {
            return new Promise((resolve) => {
              resolve(self.getUserFollowers(userId, command, params, followersCounter, selfSelf))
            },
              (reject) =>
                console.log('Error handle response from instagram server(get followers request)')
            )
          }

        }).
          catch((e) => {
            console.log('Instagram returned:' + e)
          })
      })
  }

  /**
    * Get csrf token
    * @return {Object} Promise
  */
  getCsrfToken() {
    return fetch('https://www.instagram.com',
      {
        'method': 'get',
        'headers':
          this.combineWithBaseHeader(
            {
              'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
              'accept-encoding': 'gzip, deflate, br',
              'cookie': this.generateCookie(true)
            }
          )
      }).then( t => {
        this.updateEssentialValues(t.headers._headers['set-cookie'])
        return t.text()
      }).then( html => {
        this.updateEssentialValues(html, true)
        return this.essentialValues.csrftoken
      }).catch(() =>
        console.log('Failed to get instagram csrf token')
      )
  }

  /**
    * Session id by usrname and password
    * @param {String} username
    * @param {String} password
    * @return {Object} Promise
  */
 auth(username, password) {
  var formdata = 'username=' + username + '&password=' + password + '&queryParams=%7B%7D'

  var options = {
    method  : 'POST',
    body    : formdata,
    headers : 
      this.combineWithBaseHeader(
        {
          'accept'            : '*/*',
          'accept-encoding'   : 'gzip, deflate, br',
          'content-length'    : formdata.length,
          'content-type'      : 'application/x-www-form-urlencoded',
          'cookie'            : 'ig_cb=' + this.essentialValues.ig_cb,
          'x-csrftoken'       : this.csrfToken,
          'x-instagram-ajax'  : this.rollout_hash,
          'x-requested-with'  : 'XMLHttpRequest',
        }
      )
  }

  return fetch('https://www.instagram.com/accounts/login/ajax/', options).then(
    t => {
      this.updateEssentialValues(t.headers._headers['set-cookie'])
      return this.essentialValues.sessionid;
    }).catch(() =>
      console.log('Instagram authentication failed (challenge required erro)')
    )
}

  /**
      * Registration for instagram, returning true or false
      * true if account was successfully created
      * @param {String} username
      * @param {String} password
      * @param {String} name
      * @param {String} email
      * @return {Boolen} account_created
      */
  reg(username, password, name, email) {
    let form = new formData();
    form.append('username', username)
    form.append('password', password)
    form.append('firstname', name)
    form.append('email', email)
    form.append('seamless_login_enabled', "1")

    return fetch('https://www.instagram.com/accounts/web_create_ajax/', {
      'method': 'post',
      'body': form,
      'headers': {
        'referer': 'https://www.instagram.com/',
        'origin': 'https://www.instagram.com',
        'user-agent': this.userAgent,
        'x-instagram-ajax': '1',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrftoken': this.csrfToken,
        cookie: 'csrftoken=' + this.csrfToken
      }
    })
      .then(res => res.json())
      .then(json => {
        //console.log(json.errors);
        return json.account_created;
      })
      .catch(() => console.log('Instagram registration failed'))
  }


  /**
    * I did not want to implement this, but I need a stars on github
    * If you use this library - star this rep https://github.com/yatsenkolesh/instagram-nodejs
    * Thank you, bro
    * Follow/unfollow user by id
    * @param {int} userID
    * @param {boolean} isUnfollow
    * @return {object} Promise of fetch request
  */
  follow(userId, isUnfollow) {
    const headers = this.combineWithBaseHeader(
      {
        'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        'cookie': this.generateCookie()
      }
    );

    return fetch('https://www.instagram.com/web/friendships/' + userId + (isUnfollow == 1 ? '/unfollow' : '/follow'),
      {
        'method': 'post',
        'headers': headers//headers
      }).then(res => {
        return res
      })
  }

  /**
    * @return {Object} default headers
   */
  getHeaders() {
    return {
      'referer': 'https://www.instagram.com/p/BT1ynUvhvaR/?taken-by=yatsenkolesh',
      'origin': 'https://www.instagram.com',
      'user-agent': this.userAgent,
      'x-instagram-ajax': '1',
      'x-requested-with': 'XMLHttpRequest',
      'x-csrftoken': this.csrfToken,
      cookie: ' sessionid=' + this.sessionId + '; csrftoken=' + this.csrfToken + ';'
    }
  }

  /**
    * Return user data by id
    * @param {Int} id
    * @return {Object} promise
  */
  getUserDataById(id) {
    let query = 'ig_user(' + id + '){id,username,external_url,full_name,profile_pic_url,biography,followed_by{count},follows{count},media{count},is_private,is_verified}'

    let form = new formData();
    form.append('q', query)

    return fetch('https://www.instagram.com/query/',
      {
        'method': 'post',
        'body': form,
        'headers': this.getHeaders()
      }).then(res =>
        res.json().then(t => t)
      )
  }

  /**
    * When you pass items counter param instagram create pagination
    * tokens on all iterations and gives on every response end_cursor, which the need to pass on next feed request
    *
    * This method return first "items" posts of feed
    * Coming soon will be opportunity  for get part of feed
    * On testing stage (+- all rights)
    * If you have a problems - create issue : https://github.com/yatsenkolesh/instagram-nodejs
    * @param {Int} items (default - 10)
    * @return {Object} Promise
  */
  getFeed(items, cursor) {
    items = items ? items : 10;
    return fetch('https://www.instagram.com/graphql/query/?query_id=17866917712078875&fetch_media_item_count=' + items + '&fetch_media_item_cursor=' + cursor + '&fetch_comment_count=4&fetch_like=10',
      {
        headers: this.getHeaders(),
      }).then(t =>
        // console.log(t)
        t.json().then(r => r)
      )
  }

  /**
    * Simple variable for get next page
    * @param {Object} json contents from this.getFeed
    * @return {String} if next page is not exists - false
  */
  getFeedNextPage(json) {
    let page = json.data.user.edge_web_feed_timeline.page_info

    return page.has_next_page ? page.end_cursor : false
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} post id
    * @return {Object} Promse
  */
  like(postId) {
    return fetch('https://www.instagram.com/web/likes/' + postId + '/like/',
      {
        'method': 'POST',
        'headers': this.getHeaders()
      }).then(t =>
        t.json().then(r => r)
      )
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} postId
    * @return {Object} Promse
  */
  unlike(postId) {
    return fetch('https://www.instagram.com/web/likes/' + postId + '/unlike/',
      {
        'method': 'POST',
        'headers': this.getHeaders()
      }).then(t =>
        t.json().then(r => r)
      )
  }


  /**
    * @example url = https://www.instagram.com/p/BT1ynUvhvaR/
    * @param {String} url
    * @return {Object} Promise
  */
  getMediaInfoByUrl(url) {
    return fetch('https://api.instagram.com/oembed/?url=' + url,
      {
        'headers': this.getHeaders()
      }).then(t => t.json().then(r => r))
  }

  /**
    * @example url = https://www.instagram.com/p/BT1ynUvhvaR/
    * @param {String} url
    * @return {Object} Promise
  */
  getMediaIdByUrl(url) {
    return this.getMediaInfoByUrl(url).then(t => t.media_id.split('_')[0])
  }

  /**
    * Get media user list on userId with pagination
    * @param {String} userId
    * @param {String} cursor (next cursor). Use 0, if you want to get first page
    * @param {Int} mediaCounter default - 12
    * @return {Object} Promise
  */
  getUserMedia(userId, cursor, mediaCounter) {
    cursor = cursor ? cursor : '0'
    mediaCounter = mediaCounter ? mediaCounter : 12
    let form = new formData()
    form.append('q', 'ig_user(' + userId + ') { media.after(' + cursor + ', ' + mediaCounter + ') {\
    count,\
    nodes {\
      __typename,\
      caption,\
      code,\
      comments {\
        count\
      },\
      comments_disabled,\
      date,\
      dimensions {\
        height,\
        width\
      },\
      display_src,\
      id,\
      is_video,\
      likes {\
        count\
      },\
      owner {\
        id\
      },\
      thumbnail_src,\
      video_views\
    },\
    page_info\
    }\
   }')
    form.append('ref', 'users::show')
    form.append('query_id', '17849115430193904') // this is static id. May be changed after rebuild, but now actually

    return fetch('https://www.instagram.com/query/',
      {
        headers: this.getHeaders(),
        method: 'post',
        body: form
      }).then(r => { console.log(r); return r.text() }).then(t => { console.log(t); return t;})
      .catch((e)=>{
        console.log('e => ', e);
      })
  }

  /**
    * End cursor - t.entry_data.TagPage[0].tag.media.page_info['end_cursor']
    * Media(nodes) - t.entry_data.TagPage[0].tag.media['nodes']
    * @param {String} searchBy - location, hashtag
    * @param {String} q - location id, or hashtag
    * @param {String} cursor pagination cursor
    * @param {Int} mediaCounter
    * @return {Object} Promise
  */
  searchBy(searchBy, q, cursor, mediaCounter) {
    if (this.searchTypes.indexOf(searchBy) === false)
      throw 'search type ' + searchBy + ' is not found'

    //exclusion for hashtag if not cursor
    if (searchBy == 'hashtag' && !cursor) {
      return fetch('https://www.instagram.com/explore/tags/' + q + '/',
        {
          headers: this.getHeaders(),
        }).then(t => t.text().then(r => JSON.parse(r.match(/\<script type=\"text\/javascript\">window\._sharedData \=(.*)\;<\//)[1])))
    }

    let form = new formData()
    mediaCounter = mediaCounter ? mediaCounter : 12
    form.append('q', 'ig_' + searchBy + '(' + q + ') { media.after(' + cursor + ', ' + mediaCounter + ') {\
      count,\
      nodes {\
        __typename,\
        caption,\
        code,\
        comments {\
          count\
        },\
        comments_disabled,\
        date,\
        dimensions {\
          height,\
          width\
        },\
        display_src,\
        id,\
        is_video,\
        likes {\
          count\
        },\
        owner {\
          id\
        },\
        thumbnail_src,\
        video_views\
      },\
      page_info\
    }\
     }')

    form.append('ref', 'locations::show')
    form.append('query_id', '') //empty


    return fetch('https://www.instagram.com/query/',
      {
        headers: this.getHeaders(),
        method: 'post',
        body: form
      }).then(t => t.json().then(r => r))
  }

  /**
    * Place id path - r.places[0].place.location['pk'], r.places[1].place.location['pk'], ...
    * Common search returned locations, hashtags and users
    * @param {String} q
    * @return {Object} Promise
  */
  commonSearch(q, sessionid, ownUser, rankToken) {
    return new Promise((resolve)=>{
      rankToken = rankToken ? rankToken : ''
      let headers = {
        'x-ig-capabilities': '3w==',
        'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
        'host': 'i.instagram.com',
        'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}`
      }
      const opts = {
        url: 'https://www.instagram.com/web/search/topsearch/?context=blended&query=' + q + '&rank_token=' + rankToken,
        headers,
      }
      request(opts,(err,res,body)=>{
        if(err){
          console.log(err);
          resolve(err);
        }else {
          let json_body = [];
          try{
            json_body = JSON.parse(body);
            resolve(json_body);
          }catch(e){
            console.log(e);
            resolve({users:[]});
          }
        }
        
      })
    })
  }

  /**
   * User Media Changes to grapql
   * @param {String} userId
   * @param {String} sessionid
   * @param {String} ownUser
   * @return {Object} Promise
   */
  getHighlights(userId,sessionid,ownUser,csrfToken){
    let url = `https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray`
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}; csrftoken=${csrfToken};`,
      "x-csrftoken": csrfToken,
    }
    return fetch(url,
      {
        'method': 'get',
        headers   
      }
    ).then(t => t.json().then(r => {
      return r
    }));
  }

  /**
   * User Media Changes to grapql
   * @param {String} mediaId
   * @param {String} sessionid
   * @param {String} ownUser
   * @return {Object} Promise
   */
  getHighlight(mediaId,sessionid,ownUser){
    let url = `https://i.instagram.com/api/v1/feed/reels_media/?user_ids=${mediaId}`
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}`
    }
    return fetch(url,
      {
        'method': 'get',
        headers   
      }
    ).then(t => t.json().then(r => {
      return r
    }));
  }

  /**
   * User Media Changes to grapql
   * @param {String} userId
   * @param {String} sessionid
   * @param {String} ownUser
   * @return {Object} Promise
   */
  getHDPic(userId,sessionid,ownUser,detail=false,csrfToken){
    let url = `https://i.instagram.com/api/v1/users/${userId}/info/`
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}; csrftoken=${csrfToken};`,
      "x-csrftoken": csrfToken,
    }
    return fetch(url,
      {
        'method': 'get',
        headers   
      }
    ).then(t => t.json().then(r => {
      if(!detail){
        return r.user.hd_profile_pic_url_info
      }else{
        return r.user
      }
      
    }));
  }

  /*
  */
  getCustomUserFollowers(query_hash,userId,sessionid,ownUser,end_cursor=null,csrfToken){
    let url = `https://www.instagram.com/graphql/query/?query_hash=${query_hash}&variables={%22id%22:%22${userId}%22,%22first%22:24`
    if(end_cursor) {
      url += `,%22after%22:%22${end_cursor}%22}`
    }else{
      url += "}"
    }
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}; csrftoken=${csrfToken};`,
      "x-csrftoken": csrfToken,
    }
    return fetch(url,
      {
        'method': 'get',
        headers   
      }
    ).then(t => t.json().then(r => r));
  }

  /**
   * User Media Changes to grapql
   * @param {String} userId
   * @param {Number} edge_count
   * @param {String} query_hash
   * @return {Object} Promise
   */
  userEdges(userId,edge_count,query_hash,end_cursor = null,sessionid,ownUser,csrfToken){
    let url = `https://www.instagram.com/graphql/query/?query_hash=${query_hash}&variables={%22id%22:%22${userId}%22,%22first%22:${edge_count}`
    if(end_cursor) {
      url += `,%22after%22:%22${end_cursor}%22}`
    }else{
      url += "}"
    }
    let headers = {
      'x-ig-capabilities': '3w==',
      'user-agent': 'Instagram 9.5.1 (iPhone9,2; iOS 10_0_2; en_US; en-US; scale=2.61; 1080x1920) AppleWebKit/420+',
      // 'host': 'i.instagram.com',
      'cookie': `sessionid=${sessionid}; ds_user_id=${ownUser}; csrftoken=${csrfToken};`,
      "x-csrftoken": csrfToken,
    }
    return fetch(url,
      {
        'method': 'get',
        headers   
      }
    ).then(t => t.json().then( (json)=> json ));
  }

  userStories(userId){
    return fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/reel_media/`, {
      
      'method': 'get',
      'headers':
        this.combineWithBaseHeader(
          {
            'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'cookie': this.generateCookie()
          }
        )
    }).then(t => t.json().then(r => r));
  }

}