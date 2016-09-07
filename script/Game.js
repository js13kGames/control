/**
 * The game
 * @constructor
 * @param {HTMLCanvasElement} canvas - Canvas for displaying the game
 * @param {HTMLCanvasElement} instructions - Elemement for displaying game instructions
 * @param {HTMLCanvasElement} narrative - Elemement for displaying game narrative
 * @param {HTMLCanvasElement} score - Elemement for displaying game's current score
 * @param {HTMLCanvasElement} highScore - Elemement for displaying game's high score
 */
function Game(canvas, instructions, narrative, score, highScore)
{
  this.canvas = canvas;
  this.context = canvas.getContext("2d");

  this.canvasWidth = this.canvas.width;
  this.canvasHeight = this.canvas.height;

  this.mapCenterX = 400;
  this.mapCenterY = 300;

  this.isUpPressed = false;
  this.isLeftPressed = false;
  this.isRightPressed = false;
  this.isDownPressed = false;
  this.isShootPressed = false;
  this.isGlitchPressed = false;

  this.player = ShipFactory.generateRandomShip(0, 0);
  this.bullets = [];
  this.enemies = [];
  this.items = [];
  this.explosions = [];

  this.boundarySize = 2000;
  this.halfBoundarySize = (this.boundarySize/2);

  this.stars = [];

  // Generate the star field
  for(var i=0; i<this.boundarySize; i++)
  {
    var point = Utility.getRandomPoint(0, 0, this.boundarySize);
    var opacity = Utility.getRandom(0.1, 1);
    this.stars.push({ x: point.x, y: point.y, opacity: opacity });
  }

  this.narrative = narrative;
  this.instructions = instructions;
  this.isInTutorial = true;
  this.currentTutorialStage = 0;
  this.hasMoved = false;
  this.hasShot = false;
  this.hasGlitched = false;
  this.hasGlitchedShip = false;

  this.currentScoreDisplay = score;
  this.highScoreDisplay = highScore;
  this.currentScore = 0;
  this.highScore = 0;
}

/**
 * Updates the game's state
 */
Game.prototype.update = function()
{
  var self = this;

  // Update tutorial
  self.updateTutorial();

  // Update player destruction
  if(self.player != null && self.player.isDestroyed())
  {
    self.explosions.push(new Explosion(self.player.x, self.player.y, self.player.bodyColor));
    self.player = null;
  }

  if(self.player != null)
  {
    // Handle player input
    self.handlePlayerInput();

    // Handle player glitching
    if(self.isGlitchPressed)
    {
      self.player.startGlitching();
    }
    else if(self.player.isGlitching)
    {
      self.player.stopGlitching();
    }

    // Cache player coordinates to re-center the map
    var oldPlayerX = self.player.x;
    var oldPlayerY = self.player.y;

    // Update player
    self.player.update();

    // Re-center the map
    self.mapCenterX -= (self.player.x - oldPlayerX);
    self.mapCenterY -= (self.player.y - oldPlayerY);
  }

  // Update enemies
  self.eachEntity(self.enemies, function(enemy, enemyIndex) {

    enemy.update();

    if(enemy.isDestroyed())
    {
      if(enemy.lastAttackerId === self.player.id)
      {
        self.increaseScore(100);
      }

      // Destroy enemy
      self.enemies[enemyIndex] = null;
      self.explosions.push(new Explosion(enemy.x, enemy.y, enemy.bodyColor));
      return;
    }

    var enemyBoundingCircle = enemy.getBoundingCircle();

    // Update enemy/glitch interaction
    if(self.player != null
        && self.player.isGlitching
        && enemy.canBeGlitched()
        && self.player.isInGlitchRange(enemyBoundingCircle))
    {
      self.cachePlayerCoordinates();

      // Trigger an explosion where the old ship was located
      self.explosions.push(new Explosion(self.player.x, self.player.y, self.player.bodyColor));

      // Remove the player's old ship and swap the player with the enemy
      self.player = enemy;
      self.enemies[enemyIndex] = null;

      // Reset the player's health
      self.player.health = self.player.maxHealth;

      self.recenterMap();

      self.hasGlitchedShip = true;
      self.increaseScore(1000);
      return;
    }

    if(self.player != null)
    {
      // Update enemy/player collisions
      if(self.player.intersects(enemyBoundingCircle))
      {
        self.handleCollision(self.player, enemy);
      }

      // Update enemy/player sighting
      if(enemy.behavior == ShipBehavior.Aggressive && enemy.isInSightRange(self.player.getBoundingCircle()))
      {
        enemy.target = self.player;
      }
    }

    self.eachEntity(self.enemies, function(otherEnemy) {

      if(enemy.id === otherEnemy.id)
      {
        return;
      }

      var otherEnemyBoundingCircle = otherEnemy.getBoundingCircle();

      // Update enemy/enemy collisions
      if(enemy.intersects(otherEnemyBoundingCircle))
      {
        self.handleCollision(otherEnemy, enemy);
      }

      if(enemy.target != null)
      {
        return;
      }

      // Update enemy/enemy sighting
      if(enemy.isInSightRange(otherEnemyBoundingCircle))
      {
        enemy.target = otherEnemy;
      }

    });

    // Update enemy movement
    if(enemy.behavior === ShipBehavior.Lazy)
    {
      enemy.moveForward();
    }

    if(enemy.behavior === ShipBehavior.Aggressive)
    {
      if(enemy.target != null)
      {
        // If an enemy ship is aggressive and it has a target,
        // make the enemy ship follow its target
        enemy.lookTowards(enemy.target.x, enemy.target.y);
        enemy.moveForward();

        if(enemy.canShoot())
        {
          self.bullets.push(enemy.getBullet());
          enemy.shoot();
        }
      }
      else
      {
        // Otherwise, just make the ship move forward
        enemy.moveForward();
      }
    }

    if(self.player != null && enemy.behavior === ShipBehavior.Fearful)
    {
      enemy.lookAwayFrom(self.player.x, self.player.y);
      enemy.moveForward();
    }

    // Update enemy/bullet interaction
    self.eachEntity(self.bullets, function(bullet, bulletIndex) {
      self.handleBulletInteraction(bullet, enemy, bulletIndex);
    });

    // Update the enemy's interaction with the game boundary
    self.handleBoundaryInteraction(enemy);

  });

  // Update bullets
  self.eachEntity(self.bullets, function(bullet, bulletIndex) {

    bullet.update();

    // Update bullet death
    if(bullet.range <= 0)
    {
      self.bullets[bulletIndex] = null;
    }

    if(self.player != null)
    {
      self.handleBulletInteraction(bullet, self.player, bulletIndex);
    }

  });

  // Update items
  self.eachEntity(self.items, function(item, itemIndex) {

    item.update();

    // Update player/item interaction
    if(self.player != null && self.player.contains(item.x, item.y))
    {
      self.items[itemIndex] = null;
    }

  });

  // Update explosions
  self.eachEntity(self.explosions, function(explosion, explosionIndex) {

    if(explosion.isFinished())
    {
      self.explosions[explosionIndex] = null;
    }

  });

  // Prevent player from leaving boundary
  if(self.player != null)
  {
    self.cachePlayerCoordinates();
    self.handleBoundaryInteraction(self.player);
    self.recenterMap();
  }

  // Condense the entity arrays, removing the nulls
  self.bullets = Utility.condense(self.bullets);
  self.enemies = Utility.condense(self.enemies);
  self.items = Utility.condense(self.items);
  self.explosions = Utility.condense(self.explosions);

}

/**
 * Handle a collision between two ships
 * @param {object} entityA - First entity involved in the collision
 * @param {object} entityB - Second entity involved in the collision
 */
Game.prototype.handleCollision = function(entityA, entityB) {

  var entityASpeed = entityA.speed;
  var entityBSpeed = entityB.speed;

  var collisionDamage = Math.abs(entityASpeed - entityBSpeed);

  // Damage both the player and enemy ship w/ the difference in their speeds
  if(!entityA.isTutorialShip && !entityB.isTutorialShip)
  {
    entityA.damage(collisionDamage);
    entityB.damage(collisionDamage);
  }

  // Push both the enemy and player ship backwards
  var pushBackSpeed = (entityASpeed > entityBSpeed ? entityASpeed : entityBSpeed) * 1.5;
  entityA.pushBackward(pushBackSpeed);
  entityB.pushBackward(pushBackSpeed);

}

/**
 * Handles the testing of interaction between bullet and entity
 * @param {object} bullet - Bullet to use in testing the interaction
 * @param {object} entity - Entity to use in testing the interaction
 */
Game.prototype.handleBulletInteraction = function(bullet, entity, bulletIndex) {

  if(bullet.sourceId === entity.id)
  {
    return;
  }

  if(entity.intersects(bullet.getBoundingCircle()))
  {
    if(bullet.sourceId === this.player.id)
    {
      this.increaseScore(10);
    }

    entity.damage(bullet.damage);
    entity.lastAttackerId = bullet.sourceId;
    this.bullets[bulletIndex] = null;
  }

}

/**
 * Handles the interaction between an entity and the game boundary
 * @param {object} entity - Entity to test in the interaction
 */
Game.prototype.handleBoundaryInteraction = function(entity)
{
  if(entity.x > this.halfBoundarySize)
  {
    entity.x = this.halfBoundarySize;
  }

  if(entity.x < -this.halfBoundarySize)
  {
    entity.x = -this.halfBoundarySize;
  }

  if(entity.y > this.halfBoundarySize)
  {
    entity.y = this.halfBoundarySize;
  }

  if(entity.y < -this.halfBoundarySize)
  {
    entity.y = -this.halfBoundarySize;
  }
}

/**
 * Caches the player's current coordinates for use in re-centering the map
 */
Game.prototype.cachePlayerCoordinates = function() {
  this.cachedPlayerX = this.player.x;
  this.cachedPlayerY = this.player.y;
}

/**
 * Recenters the map using a player's cached coordinates for reference
 */
Game.prototype.recenterMap = function() {
  this.mapCenterX -= (this.player.x - this.cachedPlayerX);
  this.mapCenterY -= (this.player.y - this.cachedPlayerY);
}

/**
 * Updates a game's state based on a player's input
 */
Game.prototype.handlePlayerInput = function() {

  if(this.isUpPressed)
  {
    this.player.moveForward();
    this.hasMoved = true;
  }

  if(this.isDownPressed)
  {
    this.player.moveBackward();
    this.hasMoved = true;
  }

  if(!this.isUpPressed && !this.isDownPressed)
  {
    this.player.stop();
  }

  if(this.isRightPressed)
  {
    this.player.rotateClockwise();
    this.hasMoved = true;
  }

  if(this.isLeftPressed)
  {
    this.player.rotateCounterClockwise();
    this.hasMoved = true;
  }

  if(this.isShootPressed && this.player.canShoot())
  {
    this.bullets.push(this.player.getBullet());
    this.player.shoot();
    this.hasShot = true;
  }

  if(this.isGlitchPressed)
  {
    this.hasGlitched = true;
  }

};

/**
 * Loops through each entity and calls a function on each entity
 * @param {object[]} entities - Collection of entities to update
 * @param {function} callback - Function to call on each entity
 */
Game.prototype.eachEntity = function(entities, callback)
{
  var entitiesLength = entities.length;

  for(var i=0; i<entitiesLength; i++)
  {
    var entity = entities[i];

    if(entity == null)
    {
      return;
    }

    callback(entity, i);
  }
}

/**
 * Draws the game
 */
Game.prototype.draw = function()
{
  var self = this;

  // Clear the canvas
  self.context.clearRect(0, 0, self.canvasWidth, self.canvasHeight);

  // Draw the boundary
  self.context.strokeStyle = 'rgba(255, 0, 0, 0.3)';
  self.context.lineWidth = 1;
  self.context.strokeRect(
    -this.halfBoundarySize + this.mapCenterX,
    -this.halfBoundarySize + this.mapCenterY,
    this.boundarySize,
    this.boundarySize
  );

  // Draw the stars
  self.drawStars(self.context);

  // Draw bullets
  self.drawEntitites(self.bullets);

  // Draw items
  self.drawEntitites(self.items);

  // Draw enemies
  self.drawEntitites(self.enemies);

  // Draw explosions
  self.drawEntitites(self.explosions);

  // Draw the player
  if(self.player != null)
  {
    self.player.draw(self.context, self.mapCenterX, self.mapCenterY);
  }
}

/**
 * Renders the ship
 * @param {CanvasRenderingContext2D} context - 2D rendering context to use when rendering the stars
 */
Game.prototype.drawStars = function(context) {

  var starsLength = this.stars.length;
  for(var i=0; i<starsLength; i++)
  {
    var star = this.stars[i];
    context.fillStyle = 'rgba(255, 255, 255, ' + star.opacity + ')';
    context.fillRect(star.x + this.mapCenterX, star.y + this.mapCenterY, 1, 1);
  }

}

/**
 * Draws a collection of entities
 * @param {object[]} - Collection of entities to draw
 */
Game.prototype.drawEntitites = function(entities)
{
  var self = this;

  self.eachEntity(entities, function(entity) {

    if(entity == null)
    {
      return;
    }

    entity.draw(self.context, self.mapCenterX, self.mapCenterY);
  });
}

/**
 * Updates the tutorial
 */
Game.prototype.updateTutorial = function()
{
  if(!this.isInTutorial)
  {
    return;
  }

  if(this.currentTutorialStage === 0 && this.hasMoved)
  {
    this.currentTutorialStage++;
    this.narrative.innerText = 'we must destroy';
    this.instructions.innerText = 'shoot with [X]';
  }

  if(this.currentTutorialStage === 1 && this.hasShot)
  {
    this.currentTutorialStage++;
    this.narrative.innerText = 'we must conquer';
    this.instructions.innerText = 'glitch with [Z]';
  }

  if(this.currentTutorialStage === 2 && this.hasGlitched)
  {
    this.currentTutorialStage++;
    this.narrative.innerText = 'we must control';
    this.instructions.innerText = 'glitch a weak ship to take control';
  }

  if(this.currentTutorialStage === 3 && this.hasGlitchedShip)
  {
    this.isInTutorial = false;
    this.instructions.parentNode.setAttribute('style', 'display: none');
  }
}

Game.prototype.increaseScore = function(value) {

  // Increase score
  this.currentScore += value;

  if(this.currentScore > this.highScore)
  {
    this.highScore = this.currentScore;
  }

  // Display score
  this.currentScoreDisplay.innerText = this.currentScore;
  this.highScoreDisplay.innerText = this.highScore;

}

/**
 * Starts the game
 */
Game.prototype.start = function()
{
  var self = this;

  self.canvas.addEventListener('keydown', function(event) { toggleKeys(event.keyCode, true); }, false);
  self.canvas.addEventListener('keyup', function(event) { toggleKeys(event.keyCode, false); }, false);

  function toggleKeys(keyCode, isPressed)
  {
    switch(keyCode)
    {
      // Up Arrow
      case 38:
        self.isUpPressed = isPressed;
        break;

      // Right Arrow
      case 39:
        self.isRightPressed = isPressed;
        break;

      // Left Arrow
      case 37:
        self.isLeftPressed = isPressed;
        break;

      // Down Arrow
      case 40:
        self.isDownPressed = isPressed;
        break;

      // X
      case 88:
        self.isShootPressed = isPressed;
        break;

      // Z
      case 90:
        self.isGlitchPressed = isPressed;
        break;
    }
  }

  // Generate initial ship
  var ship = ShipFactory.generateRandomShip(-400, 0);
  ship.behavior = ShipBehavior.None;
  ship.isTutorialShip = true;
  ship.health *= 0.5;

  this.enemies.push(ship);

  function loop()
  {
    self.update();
    self.draw();
    requestAnimationFrame(loop);
  }

  loop();
}
